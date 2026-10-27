import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { FiLogOut, FiMenu } from "react-icons/fi";
import {
  sendMessage as sendApiMessage,
  fetchHistory,
  fetchChatMessages,
  deleteChat,
  renameChat,
  uploadDocument,
  createChat,
  fetchDocumentStatus,
  fetchChatDocuments,
  fetchUserSettings,
  updateUserSettings
} from "../services/chatApi";
import Sidebar from "../components/Sidebar";
import TopBar from "../components/TopBar";
import ChatMessages from "../components/ChatMessages";
import Composer from "../components/Composer";

function buildAssistantMessage(text) {
  return { id: crypto.randomUUID(), role: "assistant", text };
}

function mapDocumentsToAttachments(docs = []) {
  return docs.map((doc) => {
    const status = doc.indexingStatus;
    const indexingLoading = status === "pending" || !status;
    const indexingError = status === "failed" ? doc.indexingError || "Indexing failed." : null;
    const indexingWarn =
      status === "deferred" || status === "skipped"
        ? doc.indexingError || (status === "skipped" ? "No searchable text extracted." : "Indexing deferred.")
        : null;
    return {
      name: doc.name,
      documentId: doc.documentId,
      indexingLoading,
      indexingReady: status === "completed",
      indexingError,
      indexingWarn,
      chunks: doc.indexedChunks ?? 0
    };
  });
}

export default function ChatPage({ user, onLogout, theme, onSetTheme }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDesktopCollapsed, setIsDesktopCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userSettings, setUserSettings] = useState({
    theme: theme || "dark",
    microphoneEnabled: true,
    useRedis: true,
    useVector: true,
    sidebarCollapsed: false
  });
  const messagesRef = useRef(null);
  /** Session that triggered the upload; pinned notice is appended there when indexing completes. */
  const uploadAnchorSessionRef = useRef(null);

  useEffect(() => {
    async function loadInitialData() {
      try {
        const historyRes = await fetchHistory();
        const historyData = historyRes.data || [];
        const formattedSessions = historyData.map(chat => ({
          id: chat.id,
          title: chat.title || "Untitled Chat",
          messages: []
        }));
        
        setSessions(formattedSessions);

        if (id) {
          setActiveSessionId(id);
        } else {
          // If at /chat, ensure we have a fresh local session
          const localId = "local-" + crypto.randomUUID();
          setSessions(prev => [
            {
              id: localId,
              title: "New chat",
              messages: [buildAssistantMessage("Hi, I am FlareGPT. How can I help?")]
            },
            ...formattedSessions
          ]);
          setActiveSessionId(localId);
        }
      } catch (err) {
        console.error("Failed to load history", err);
        toast.error("Session expired or network error. Please login again.");
        onLogout();
      }
    }
    
    loadInitialData();
  }, [id]); // Reload when ID changes (e.g. going back to /chat)

  useEffect(() => {
    async function loadSettings() {
      try {
        const settingsRes = await fetchUserSettings();
        const settings = settingsRes?.data;
        if (!settings) return;
        setUserSettings(settings);
        if (settings.theme && settings.theme !== theme) {
          onSetTheme?.(settings.theme);
        }
        if (typeof settings.sidebarCollapsed === "boolean") {
          setIsDesktopCollapsed(settings.sidebarCollapsed);
        }
      } catch (error) {
        console.error("Failed to load user settings", error);
      }
    }
    loadSettings();
  }, []);

  // Lazy load messages when switching sessions
  useEffect(() => {
    async function loadMessages() {
      if (!activeSessionId || String(activeSessionId).startsWith("local-")) return;
      
      const currentSession = sessions.find(s => s.id === activeSessionId);
      if (!currentSession || currentSession.messages.length > 0) return;
      
      setLoading(true);
      try {
        const msgsRes = await fetchChatMessages(activeSessionId);
        const msgsData = msgsRes.data || [];
        
        const formattedMsgs = msgsData.map(m => ({
          id: m.id,
          role: m.role,
          text: m.text
        }));
        
        if (formattedMsgs.length === 0) {
           formattedMsgs.push(buildAssistantMessage("Hi, I am FlareGPT. How can I help?"));
        }
        
        setSessions(prev => prev.map(s => 
          s.id === activeSessionId ? { ...s, messages: formattedMsgs } : s
        ));
      } catch (err) {
        console.error("Failed to load messages", err);
        toast.error("Failed to load conversation history.");
      } finally {
        setLoading(false);
      }
    }
    
    loadMessages();
  }, [activeSessionId, sessions]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 921px)");
    const syncForViewport = () => {
      if (media.matches) {
        setSidebarOpen(true);
      } else {
        setSidebarOpen(false);
      }
    };
    syncForViewport();
    media.addEventListener("change", syncForViewport);
    return () => media.removeEventListener("change", syncForViewport);
  }, []);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || null,
    [sessions, activeSessionId]
  );

  const messages = activeSession?.messages ?? [];

  useEffect(() => {
    const node = messagesRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, loading]);

  function updateActiveSession(updater) {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === activeSessionId ? { ...session, ...updater(session) } : session
      )
    );
  }

  function createNewChat() {
    navigate("/chat");
    setAttachments([]);
    setSidebarOpen(false);
  }

  async function loadChatDocuments(chatId) {
    if (!chatId || String(chatId).startsWith("local-")) {
      setAttachments([]);
      return;
    }
    try {
      const res = await fetchChatDocuments(chatId);
      setAttachments(mapDocumentsToAttachments(res?.data || []));
    } catch (error) {
      console.error("Failed to load chat documents", error);
      setAttachments([]);
    }
  }

  async function sendMessage(message) {
    const trimmed = message.trim();
    if (!trimmed || !activeSessionId) return;

    if (attachments.some((item) => item.indexingLoading)) {
      toast.error("Wait until indexing finishes for all pinned documents.");
      return;
    }

    const isLocal = String(activeSessionId).startsWith("local-");

    const userMessage = { id: crypto.randomUUID(), role: "user", text: trimmed };
    setSessions(prev => prev.map(s => 
      s.id === activeSessionId 
      ? { ...s, title: s.title === "New chat" ? trimmed.slice(0, 32) : s.title, messages: [...s.messages, userMessage] }
      : s
    ));

    setLoading(true);
    // Do not append extracted PDF text to prompt.
    // Document context should come from backend vector retrieval only.
    const prompt = trimmed;
      
    try {
      const body = await sendApiMessage(prompt, isLocal ? null : activeSessionId);
      if (!body) throw new Error("No response body");

      const reader = body.getReader();
      const decoder = new TextDecoder();
      
      let assistantText = "";
      let serverChatId = null;
      let buffer = "";

      // Add a placeholder assistant message that we will update
      const assistantMessageId = crypto.randomUUID();
      setSessions(prev => prev.map(s => 
        s.id === activeSessionId 
        ? { ...s, messages: [...s.messages, { id: assistantMessageId, role: "assistant", text: "" }] }
        : s
      ));

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const dataStr = trimmed.slice(5).trim();
          if (dataStr === "[DONE]") break;
          
          try {
            const data = JSON.parse(dataStr);
            if (data.text) {
              assistantText += data.text;
              if (data.chatId) serverChatId = data.chatId;
              
              // Update the specific assistant message in the active session
              setSessions(prev => prev.map(s => 
                s.id === activeSessionId 
                ? { 
                    ...s, 
                    messages: s.messages.map(m => 
                      m.id === assistantMessageId ? { ...m, text: assistantText } : m
                    )
                  }
                : s
              ));
            }
          } catch (e) {
            // Partial JSON chunk, skip
          }
        }
      }

      if (isLocal && serverChatId) {
        // Switch from local ID to server ID
        setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, id: serverChatId } : s));
        navigate(`/chat/${serverChatId}`, { replace: true });
      }
    } catch (error) {
      console.error("Message send failed", error);
      toast.error(error.message || "Failed to send message. Please try again.");
    } finally {
      setLoading(false);
      uploadAnchorSessionRef.current = null;
    }
  }

  const pendingIndexingKey = useMemo(
    () =>
      attachments
        .filter((item) => item.indexingLoading && item.documentId)
        .map((item) => item.documentId)
        .sort()
        .join(","),
    [attachments]
  );

  // Poll every attachment that is still indexing.
  useEffect(() => {
    if (!pendingIndexingKey) return undefined;
    const pendingIds = pendingIndexingKey.split(",").filter(Boolean);
    const pending = pendingIds
      .map((documentId) => attachments.find((item) => item.documentId === documentId))
      .filter(Boolean);
    if (pending.length === 0) return undefined;

    let cancelled = false;
    const timers = new Map();

    function appendPinnedNotice(fileLabel) {
      const targetId = uploadAnchorSessionRef.current || activeSessionId;
      if (!targetId) return;
      setSessions((prev) =>
        prev.map((session) =>
          session.id !== targetId
            ? session
            : {
                ...session,
                messages: [
                  ...session.messages,
                  {
                    id: crypto.randomUUID(),
                    role: "user",
                    text: `Pinned document: ${fileLabel}`
                  }
                ]
              }
        )
      );
    }

    function updateAttachment(docId, patch) {
      setAttachments((prev) =>
        prev.map((item) => (item.documentId === docId ? { ...item, ...patch } : item))
      );
    }

    async function pollOne(doc) {
      if (cancelled) return;
      try {
        const res = await fetchDocumentStatus(doc.documentId);
        if (cancelled) return;
        const status = res?.data?.indexingStatus;
        if (status === "completed") {
          updateAttachment(doc.documentId, {
            indexingLoading: false,
            indexingReady: true,
            indexingError: null,
            indexingWarn: null,
            chunks: res?.data?.indexedChunks ?? 0
          });
          appendPinnedNotice(doc.name);
          toast.success(`${doc.name} indexed.`);
          return;
        }
        if (status === "failed") {
          const errMsg = res?.data?.indexingError || "Indexing failed.";
          updateAttachment(doc.documentId, {
            indexingLoading: false,
            indexingReady: false,
            indexingError: errMsg
          });
          toast.error(`${doc.name}: ${errMsg}`);
          return;
        }
        if (status === "deferred" || status === "skipped") {
          const reason = res?.data?.indexingError || res?.data?.reason;
          updateAttachment(doc.documentId, {
            indexingLoading: false,
            indexingReady: false,
            indexingWarn:
              reason ||
              (status === "skipped" ? "No searchable text extracted." : "Indexing deferred.")
          });
          appendPinnedNotice(doc.name);
          toast(reason ? String(reason) : `${doc.name}: ${status}`);
          return;
        }
        timers.set(
          doc.documentId,
          window.setTimeout(() => pollOne(doc), 2000)
        );
      } catch (_) {
        if (cancelled) return;
        timers.set(
          doc.documentId,
          window.setTimeout(() => pollOne(doc), 3000)
        );
      }
    }

    for (const doc of pending) {
      pollOne(doc);
    }

    return () => {
      cancelled = true;
      for (const timer of timers.values()) window.clearTimeout(timer);
    };
    // pendingIndexingKey intentionally drives restarts; snapshot `pending` at effect start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingIndexingKey, activeSessionId]);

  useEffect(() => {
    loadChatDocuments(activeSessionId);
  }, [activeSessionId]);

  async function persistSettings(nextSettings) {
    setUserSettings(nextSettings);
    if (nextSettings.theme && nextSettings.theme !== theme) {
      onSetTheme?.(nextSettings.theme);
    }
    if (typeof nextSettings.sidebarCollapsed === "boolean") {
      setIsDesktopCollapsed(nextSettings.sidebarCollapsed);
    }

    try {
      const saved = await updateUserSettings(nextSettings);
      if (saved?.data) {
        setUserSettings(saved.data);
        if (saved.data.theme && saved.data.theme !== theme) {
          onSetTheme?.(saved.data.theme);
        }
        if (typeof saved.data.sidebarCollapsed === "boolean") {
          setIsDesktopCollapsed(saved.data.sidebarCollapsed);
        }
      }
    } catch (error) {
      console.error("Failed to save settings", error);
      toast.error("Failed to save settings");
    }
  }

  async function handlePdfPick(file) {
    if (!file) return;
    if (!activeSessionId) {
      toast.error("Open a conversation before uploading a document.");
      return;
    }

    const toastId = toast.loading(`Uploading ${file.name}…`);
    try {
      // Vectors are scoped by chatId. Promote local draft chats to a real server
      // chat before upload so retrieval stays conversation-only.
      let chatId = activeSessionId;
      if (String(chatId).startsWith("local-")) {
        const created = await createChat(
          file.name ? `Chat · ${String(file.name).slice(0, 40)}` : "New chat"
        );
        const realId = created?.data?.id;
        if (!realId) throw new Error("Failed to create conversation for upload.");

        const previousId = chatId;
        setSessions((prev) =>
          prev.map((session) =>
            session.id === previousId
              ? { ...session, id: realId, title: created.data.title || session.title }
              : session
          )
        );
        setActiveSessionId(realId);
        navigate(`/chat/${realId}`, { replace: true });
        chatId = realId;
      }

      uploadAnchorSessionRef.current = chatId;
      const result = await uploadDocument(file, chatId);
      toast.dismiss(toastId);

      const data = result?.data ?? {};
      const immediateStatus = data.indexingStatus;
      const documentId = data.documentId;

      const nextAttachment = {
        name: file.name,
        documentId,
        indexingLoading: immediateStatus !== "completed" && immediateStatus !== "failed",
        indexingReady: immediateStatus === "completed",
        indexingError:
          immediateStatus === "failed" || result?.status === "partial"
            ? data.indexingError || "Indexing could not be queued."
            : null,
        indexingWarn: null
      };

      setAttachments((prev) => {
        const withoutDup = prev.filter((item) => item.documentId !== documentId);
        return [...withoutDup, nextAttachment];
      });

      if (immediateStatus === "failed" || result?.status === "partial") {
        toast.error(data.indexingError || "Document uploaded but indexing failed.");
        return;
      }

      if (immediateStatus === "completed") {
        toast.success(`${file.name} ready.`);
        appendPinnedNoticeForFile(file.name);
      } else {
        toast.success(`${file.name} uploaded — indexing…`, { duration: 2800 });
      }
    } catch (err) {
      console.error("Upload failed", err);
      toast.error(err.message || "Failed to upload document", { id: toastId });
    }
  }

  function appendPinnedNoticeForFile(label) {
    const targetId = uploadAnchorSessionRef.current || activeSessionId;
    if (!targetId) return;
    setSessions((prev) =>
      prev.map((session) =>
        session.id !== targetId
          ? session
          : {
              ...session,
              messages: [
                ...session.messages,
                {
                  id: crypto.randomUUID(),
                  role: "user",
                  text: `Pinned document: ${label}`
                }
              ]
            }
      )
    );
  }

  function handleSelectSession(sessionId) {
    navigate(`/chat/${sessionId}`);
    if (window.matchMedia("(max-width: 920px)").matches) {
      setSidebarOpen(false);
    }
  }

  async function handleRenameChat(chatId, title) {
    try {
      if (String(chatId).startsWith("local-")) {
        setSessions((prev) =>
          prev.map((session) => (session.id === chatId ? { ...session, title } : session))
        );
        return;
      }
      const res = await renameChat(chatId, title);
      const nextTitle = res?.data?.title || title;
      setSessions((prev) =>
        prev.map((session) =>
          session.id === chatId ? { ...session, title: nextTitle } : session
        )
      );
      toast.success("Conversation renamed.");
    } catch (err) {
      console.error("Failed to rename chat", err);
      toast.error(err.message || "Could not rename chat.");
    }
  }

  function handleToggleSidebar() {
    if (window.matchMedia("(max-width: 920px)").matches) {
      setSidebarOpen((prev) => !prev);
      return;
    }
    setIsDesktopCollapsed((prev) => !prev);
  }

  async function handleDeleteChat(chatId) {
    try {
      if (!String(chatId).startsWith("local-")) {
        await deleteChat(chatId);
      }

      let nextSessions = [];
      setSessions((prev) => {
        nextSessions = prev.filter((s) => s.id !== chatId);
        return nextSessions;
      });

      if (activeSessionId === chatId) {
        setAttachments([]);
        if (nextSessions.length > 0) {
          navigate(`/chat/${nextSessions[0].id}`);
        } else {
          navigate("/chat");
        }
      }
      toast.success("Conversation deleted.");
    } catch (err) {
      console.error("Failed to delete chat", err);
      toast.error(err.message || "Could not delete chat. Please try again.");
    }
  }

  return (
    <main className={`layout ${isDesktopCollapsed ? "desktop-collapsed" : ""}`}>
      {sidebarOpen && window.matchMedia("(max-width: 920px)").matches ? (
        <button className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      ) : null}
      <Sidebar
        appName="FlareGPT"
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={createNewChat}
        user={user}
        onLogout={onLogout}
        logoutIcon={<FiLogOut size={16} />}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        isDesktopCollapsed={isDesktopCollapsed}
        onDeleteChat={handleDeleteChat}
        onRenameChat={handleRenameChat}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {settingsOpen ? (
        <div className="upload-modal-backdrop" role="dialog" aria-modal="true" aria-label="Settings">
          <div className="upload-modal settings-modal">
            <button type="button" className="upload-close" onClick={() => setSettingsOpen(false)}>
              x
            </button>
            <h3>User Settings</h3>
            <p>Control theme and account-level AI features from Cloudflare KV.</p>
            <div className="settings-grid">
              <label className="settings-row">
                <span>Theme</span>
                <select
                  value={userSettings.theme}
                  onChange={(e) => persistSettings({ ...userSettings, theme: e.target.value })}
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </label>
              <label className="settings-row">
                <span>Enable microphone</span>
                <input
                  type="checkbox"
                  checked={Boolean(userSettings.microphoneEnabled)}
                  onChange={(e) => persistSettings({ ...userSettings, microphoneEnabled: e.target.checked })}
                />
              </label>
              <label className="settings-row">
                <span>Use Redis cache</span>
                <input
                  type="checkbox"
                  checked={Boolean(userSettings.useRedis)}
                  onChange={(e) => persistSettings({ ...userSettings, useRedis: e.target.checked })}
                />
              </label>
              <label className="settings-row">
                <span>Use Vector search</span>
                <input
                  type="checkbox"
                  checked={Boolean(userSettings.useVector)}
                  onChange={(e) => persistSettings({ ...userSettings, useVector: e.target.checked })}
                />
              </label>
              <label className="settings-row">
                <span>Collapse desktop sidebar</span>
                <input
                  type="checkbox"
                  checked={Boolean(userSettings.sidebarCollapsed)}
                  onChange={(e) => persistSettings({ ...userSettings, sidebarCollapsed: e.target.checked })}
                />
              </label>
            </div>
            <div className="upload-actions">
              <button type="button" className="email-btn upload-cta" onClick={() => setSettingsOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <section className="chat-panel">
        <TopBar
          appName="FlareGPT"
          onToggleSidebar={handleToggleSidebar}
          menuIcon={<FiMenu size={18} />}
        />
        <ChatMessages messages={messages} typing={loading} messagesRef={messagesRef} userName={user?.name} />
        <Composer
          input={input}
          setInput={setInput}
          onSend={sendMessage}
          loading={loading}
          onPdfPick={handlePdfPick}
          attachments={attachments}
          onClearAttachment={(documentId) =>
            setAttachments((prev) => prev.filter((item) => item.documentId !== documentId))
          }
          microphoneEnabled={Boolean(userSettings.microphoneEnabled)}
        />
      </section>
    </main>
  );
}
