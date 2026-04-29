import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { FiCopy, FiCheck } from 'react-icons/fi';

function TypingRow() {
  return (
    <div className="row assistant">
      <div className="avatar">AI</div>
      <div className="typing-dots" aria-label="Assistant is typing">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function getInitials(name) {
  if (!name) return "U";
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "U";
}

function CodeBlock({ language, value, ...props }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span className="code-language">{language}</span>
        <button className="code-copy-btn" onClick={handleCopy} aria-label="Copy code">
          {copied ? <FiCheck size={14} /> : <FiCopy size={14} />}
          {copied ? "Copied!" : "Copy code"}
        </button>
      </div>
      <SyntaxHighlighter
        {...props}
        children={value}
        style={vscDarkPlus}
        language={language}
        PreTag="div"
        customStyle={{
          margin: 0,
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
          borderBottomLeftRadius: '8px',
          borderBottomRightRadius: '8px',
        }}
      />
    </div>
  );
}

function MessageActionBar({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="message-action-bar">
      <button className="msg-copy-btn" onClick={handleCopy} aria-label="Copy message" title="Copy message">
        {copied ? <FiCheck size={14} /> : <FiCopy size={14} />}
      </button>
    </div>
  );
}

export default function ChatMessages({ messages, typing, messagesRef, userName }) {
  const userInitials = getInitials(userName);
  const [expandedUserMessages, setExpandedUserMessages] = useState(() => new Set());

  const toggleUserMessageExpansion = (messageId) => {
    setExpandedUserMessages((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  return (
    <section className="conversation" ref={messagesRef} aria-live="polite">
      <div className="conversation-inner">
        {messages.map((message) => {
          const isExpanded = expandedUserMessages.has(message.id);
          const shouldShowToggle =
            message.role === "user" &&
            typeof message.text === "string" &&
            (message.text.length > 180 || message.text.includes("\n"));

          return (
          <div key={message.id} className={`row ${message.role}`}>
            {message.role === "assistant" ? <div className="avatar">AI</div> : null}
            {message.role === "user" ? <div className="avatar user-avatar">{userInitials}</div> : null}
            <article className={`message ${message.role}`}>
              {message.role === "assistant" ? (
                <>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({node, inline, className, children, ...props}) {
                        const match = /language-(\w+)/.exec(className || '')
                        return !inline && match ? (
                          <CodeBlock 
                            language={match[1]} 
                            value={String(children).replace(/\n$/, '')} 
                            {...props} 
                          />
                        ) : (
                          <code {...props} className={className}>
                            {children}
                          </code>
                        )
                      }
                    }}
                  >
                    {message.text}
                  </ReactMarkdown>
                  <MessageActionBar text={message.text} />
                </>
              ) : (
                <>
                  <p
                    className={`user-message-clamped ${isExpanded ? "user-message-expanded" : ""}`}
                    title={message.text}
                  >
                    {message.text}
                  </p>
                  {shouldShowToggle ? (
                    <button
                      type="button"
                      className="user-message-toggle"
                      onClick={() => toggleUserMessageExpansion(message.id)}
                    >
                      {isExpanded ? "Show less" : "Show more"}
                    </button>
                  ) : null}
                </>
              )}
            </article>
          </div>
        )})}
        {typing ? <TypingRow /> : null}
      </div>
    </section>
  );
}
