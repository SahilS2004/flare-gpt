import logo from "../assest/flare_gpt_logo.png";

export default function TopBar({
  appName,
  onToggleSidebar,
  menuIcon
}) {
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <img src={logo} alt={`${appName} logo`} className="topbar-logo" />
        <span className="topbar-app-name">{appName}</span>
      </div>
      <button type="button" className="menu-btn" onClick={onToggleSidebar} title="Toggle sidebar">
        {menuIcon}
      </button>
    </header>
  );
}
