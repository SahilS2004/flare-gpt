import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { FiLogOut, FiMenu } from "react-icons/fi";
import {
  sendMessage as sendApiMessage,
  fetchHistory,
  fetchChatMessages,
  deleteChat,
  uploadDocument,
  fetchDocumentStatus,
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function ChatPage({ user, onLogout, theme, onSetTheme }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [attachment, setAttachment] = useState(null);
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
  const initializedRef = useRef(false);
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
    setAttachment(null);
    setSidebarOpen(false);
  }

  async function sendMessage(message) {
    const trimmed = message.trim();
    if (!trimmed || !activeSessionId) return;

    if (attachment?.indexingLoading) {
      toast.error("Wait until indexing finishes for the pinned document.");
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
      setAttachment(null);
      uploadAnchorSessionRef.current = null;
    }
  }

  // Poll indexing until D1 marks the document completed (or terminal failure/skip).
  useEffect(() => {
    const docId = attachment?.documentId;
    const indexingLoading = attachment?.indexingLoading;
    if (!docId || !indexingLoading) return undefined;

    const fileLabel = attachment.name;
    let cancelled = false;
    let timeoutId;

    function appendPinnedNotice() {
      const targetId = uploadAnchorSessionRef.current;
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

    async function poll() {
      if (cancelled) return;
      try {
        const res = await fetchDocumentStatus(docId);
        if (cancelled) return;
        const status = res?.data?.indexingStatus;
        if (status === "completed") {
          setAttachment((prev) => {
            if (!prev || prev.documentId !== docId) return prev;
            return {
              ...prev,
              indexingLoading: false,
              indexingReady: true,
              indexingError: null,
              indexingWarn: null,
              chunks: res?.data?.indexedChunks ?? 0
            };
          });
          appendPinnedNotice();
          toast.success("Document indexed — ready for search.");
          return;
        }
        if (status === "failed") {
          const errMsg = res?.data?.indexingError || "Indexing failed.";
          setAttachment((prev) => {
            if (!prev || prev.documentId !== docId) return prev;
            return {
              ...prev,
              indexingLoading: false,
              indexingReady: false,
              indexingError: errMsg
            };
          });
          toast.error(errMsg);
          return;
        }
        if (status === "deferred" || status === "skipped") {
          const reason = res?.data?.indexingError || res?.data?.reason;
          setAttachment((prev) => {
            if (!prev || prev.documentId !== docId) return prev;
            return {
              ...prev,
              indexingLoading: false,
              indexingReady: false,
              indexingWarn:
                reason ||
                (status === "skipped"
                  ? "No searchable text extracted."
                  : "Indexing deferred.")
            };
          });
          appendPinnedNotice();
          toast(reason ? String(reason) : `Document status: ${status}`);
          return;
        }
        timeoutId = window.setTimeout(() => {
          poll();
        }, 2000);
      } catch (_) {
        if (cancelled) return;
        timeoutId = window.setTimeout(() => {
          poll();
        }, 3000);
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [attachment?.documentId, attachment?.indexingLoading, attachment?.name]);

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

    const toastId = toast.loading("Uploading file…");
    uploadAnchorSessionRef.current = activeSessionId;
    try {
      const isLocal = String(activeSessionId).startsWith("local-");
      const result = await uploadDocument(file, isLocal ? null : activeSessionId);
      toast.dismiss(toastId);

      const data = result?.data ?? {};
      const immediateStatus = data.indexingStatus;
      const documentId = data.documentId;

      if (immediateStatus === "failed" || result?.status === "partial") {
        setAttachment({
          name: file.name,
          documentId,
          indexingLoading: false,
          indexingReady: false,
          indexingError: data.indexingError || "Indexing could not be queued.",
          indexingWarn: null
        });
        toast.error(data.indexingError || "Document uploaded but indexing failed.");
        uploadAnchorSessionRef.current = null;
        return;
      }

      const loading = immediateStatus !== "completed";

      setAttachment({
        name: file.name,
        documentId,
        indexingLoading: loading,
        indexingReady: immediateStatus === "completed",
        indexingError: null,
        indexingWarn: null
      });

      if (immediateStatus === "completed") {
        toast.success("Document ready.");
        appendPinnedNoticeForFile(file.name);
      } else {
        toast.success("File uploaded — building search index…", { duration: 2800 });
      }
    } catch (err) {
      console.error("Upload failed", err);
      toast.error("Failed to upload document", { id: toastId });
      uploadAnchorSessionRef.current = null;
    }
  }

  function appendPinnedNoticeForFile(label) {
    const targetId = uploadAnchorSessionRef.current;
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
      
      const updatedSessions = sessions.filter(s => s.id !== chatId);
      setSessions(updatedSessions);

      if (activeSessionId === chatId) {
        if (updatedSessions.length > 0) {
          navigate(`/chat/${updatedSessions[0].id}`);
        } else {
          navigate("/chat");
        }
      }
    } catch (err) {
      console.error("Failed to delete chat", err);
      toast.error("Could not delete chat. Please try again.");
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
          attachment={attachment}
          onClearAttachment={() => setAttachment(null)}
          microphoneEnabled={Boolean(userSettings.microphoneEnabled)}
        />
      </section>
    </main>
  );
}
