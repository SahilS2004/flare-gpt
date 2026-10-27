import { useState } from "react";
import { FiEdit2, FiEdit3, FiTrash2, FiSettings, FiCheck, FiX } from "react-icons/fi";
import logo from "../assest/flare_gpt_logo.png";

function getInitials(name) {
  if (!name) return "U";
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

export default function Sidebar({
  appName,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  user,
  onLogout,
  logoutIcon,
  isOpen,
  onClose,
  isDesktopCollapsed,
  onDeleteChat,
  onRenameChat,
  onOpenSettings
}) {
  const [showSettings, setShowSettings] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const userInitials = getInitials(user?.name || "User");

  function startRename(session, event) {
    event.stopPropagation();
    if (String(session.id).startsWith("local-")) return;
    setRenamingId(session.id);
    setRenameValue(session.title || "");
  }

  async function commitRename(sessionId) {
    const next = renameValue.trim();
    setRenamingId(null);
    if (!next) return;
    await onRenameChat?.(sessionId, next);
  }

  function cancelRename(event) {
    event?.stopPropagation();
    setRenamingId(null);
    setRenameValue("");
  }

  return (
    <aside className={`sidebar ${isOpen ? "open" : ""} ${isDesktopCollapsed ? "collapsed" : ""}`}>
      <div className="brand">
        <img src={logo} alt={`${appName} logo`} className="sidebar-logo" />
        <span className="brand-label">{appName}</span>
      </div>

      <button type="button" className="new-chat-btn" onClick={onNewChat}>
        <FiEdit3 size={16} />
        <span className="sidebar-label">New chat</span>
      </button>

      <nav className="history" aria-label="chat history">
        <p className="history-label">Recents</p>
        {sessions.map((session) => (
          <div key={session.id} className={`history-item ${session.id === activeSessionId ? "active" : ""}`}>
            {renamingId === session.id ? (
              <form
                className="history-rename-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  commitRename(session.id);
                }}
              >
                <input
                  className="history-rename-input"
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  autoFocus
                  maxLength={64}
                  aria-label="Rename conversation"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") cancelRename(event);
                  }}
                />
                <button type="submit" className="history-action-btn" title="Save name">
                  <FiCheck size={14} />
                </button>
                <button type="button" className="history-action-btn" title="Cancel" onClick={cancelRename}>
                  <FiX size={14} />
                </button>
              </form>
            ) : (
              <>
                <button
                  type="button"
                  className="history-item-btn"
                  onClick={() => onSelectSession(session.id)}
                >
                  {session.title}
                </button>
                <button
                  type="button"
                  className="history-action-btn history-rename-btn"
                  onClick={(event) => startRename(session, event)}
                  title="Rename chat"
                  disabled={String(session.id).startsWith("local-")}
                >
                  <FiEdit2 size={14} />
                </button>
                <button
                  type="button"
                  className="history-action-btn history-delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm("Are you sure you want to delete this chat?")) {
                      onDeleteChat(session.id);
                    }
                  }}
                  title="Delete chat"
                >
                  <FiTrash2 size={14} />
                </button>
              </>
            )}
          </div>
        ))}
      </nav>

      <div className="sidebar-bottom">
        {showSettings && (
          <div className="settings-menu">
            <button type="button" className="ghost-btn side-action" onClick={() => { onOpenSettings?.(); setShowSettings(false); }}>
              <FiSettings size={16} />
              <span className="sidebar-label">Preferences</span>
            </button>
            <button type="button" className="ghost-btn side-action" onClick={() => { onLogout(); setShowSettings(false); }}>
              {logoutIcon}
              <span className="sidebar-label">Logout</span>
            </button>
          </div>
        )}

        <div className="user-pill side-user" onClick={() => setShowSettings(!showSettings)}>
          {user?.avatar ? (
            <img src={user.avatar} alt={user.name} />
          ) : (
            <div className="fallback-avatar">{userInitials}</div>
          )}
          <span className="sidebar-label">{user?.name ?? "User"}</span>
          {!isDesktopCollapsed && <FiSettings className="settings-icon" size={16} />}
        </div>
      </div>

      <button type="button" className="sidebar-close" onClick={onClose} aria-label="Close sidebar">
        Close
      </button>
    </aside>
  );
}
