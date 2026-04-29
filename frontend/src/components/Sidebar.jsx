import { useState } from "react";
import { FiEdit3, FiTrash2, FiSettings } from "react-icons/fi";
import { RiSparklingLine } from "react-icons/ri";
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
  onOpenSettings
}) {
  const [showSettings, setShowSettings] = useState(false);
  const userInitials = getInitials(user?.name || "User");

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
            <button
              type="button"
              className="history-item-btn"
              onClick={() => onSelectSession(session.id)}
            >
              {session.title}
            </button>
            <button
              type="button"
              className="history-delete-btn"
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
