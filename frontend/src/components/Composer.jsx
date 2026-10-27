import { useRef, useState } from "react";
import { HiOutlinePaperClip } from "react-icons/hi2";
import { IoSend } from "react-icons/io5";
import { FiFileText, FiUploadCloud, FiX, FiMic, FiMicOff } from "react-icons/fi";
import { transcribeAudio } from "../services/chatApi";
import toast from "react-hot-toast";

export default function Composer({
  input,
  setInput,
  onSend,
  loading,
  onPdfPick,
  attachments = [],
  onClearAttachment,
  microphoneEnabled = true
}) {
  const anyIndexing = attachments.some((item) => item.indexingLoading);
  const composerLocked = loading || anyIndexing;

  const fileInputRef = useRef(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  async function onSubmit(event) {
    event.preventDefault();
    const value = input;
    setInput("");
    await onSend(value);
  }

  function openPicker() {
    setUploadModalOpen(true);
  }

  async function onFileChange(event) {
    const files = Array.from(event.target.files || []);
    for (const file of files) {
      await onPdfPick(file);
    }
    event.target.value = "";
  }

  function closeUploadModal() {
    setUploadModalOpen(false);
  }

  function triggerFilePicker() {
    fileInputRef.current?.click();
  }

  async function toggleRecording() {
    if (!microphoneEnabled) {
      toast.error("Microphone is disabled in settings.");
      return;
    }
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          setIsRecording(false);
          try {
            const result = await transcribeAudio(audioBlob);
            if (result.status === "success" && result.data && result.data.text) {
              setInput((prev) => (prev ? prev + " " + result.data.text : result.data.text));
            } else {
              toast.error("Could not understand the audio.");
            }
          } catch (err) {
            console.error("Transcription failed", err);
            toast.error("Transcription failed. Please try again.");
          }
          stream.getTracks().forEach((track) => track.stop());
        };

        mediaRecorder.start();
        setIsRecording(true);
      } catch (err) {
        console.error("Could not start recording", err);
        toast.error("Could not access microphone. Please check permissions.");
      }
    }
  }

  return (
    <div className="composer-zone">
      {uploadModalOpen ? (
        <div className="upload-modal-backdrop" role="dialog" aria-modal="true" aria-label="Upload PDF">
          <div className="upload-modal">
            <button type="button" className="upload-close" onClick={closeUploadModal}>
              <FiX size={16} />
            </button>
            <div className="upload-icon">
              <FiFileText size={22} />
            </div>
            <h3>Upload PDF Documents</h3>
            <p>Add one or more PDFs to this conversation. FlareGPT searches only files pinned here.</p>
            {attachments.length > 0 ? (
              <div className="upload-file-list">
                {attachments.map((item) => (
                  <div key={item.documentId || item.name} className="upload-file-pill">
                    {item.name}
                    {item.indexingLoading ? (
                      <span className="doc-index-loader-inline" aria-label="Indexing" />
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="upload-actions">
              <button type="button" className="ghost-btn" onClick={closeUploadModal}>
                Cancel
              </button>
              <button type="button" className="email-btn upload-cta" onClick={triggerFilePicker}>
                <FiUploadCloud size={16} />
                Choose PDFs
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {attachments.length > 0 ? (
        <div className="attached-files-stack" aria-live="polite">
          {attachments.map((attachment) => {
            const indexing = Boolean(attachment.indexingLoading);
            const indexingError = attachment.indexingError;
            const indexingWarn = attachment.indexingWarn;
            const indexReady = !indexing && !indexingError && !indexingWarn;
            return (
              <div
                key={attachment.documentId || attachment.name}
                className={`attached-file-bar ${indexing ? "attached-file-bar--busy" : ""}`}
              >
                <FiFileText size={15} />
                <span className="attached-file-name">{attachment.name}</span>
                {indexing ? <span className="doc-index-spinner" aria-hidden /> : null}
                <span
                  className={`attached-file-note ${
                    indexingError ? "attached-file-note--error" : ""
                  } ${indexingWarn ? "attached-file-note--warn" : ""}`}
                >
                  {indexingError
                    ? indexingError
                    : indexingWarn
                    ? indexingWarn
                    : indexing
                    ? "Indexing embeddings for search…"
                    : indexReady
                    ? "Ready for this conversation"
                    : "Pinned to this conversation"}
                </span>
                <button
                  type="button"
                  className="attached-file-remove"
                  onClick={() => onClearAttachment?.(attachment.documentId)}
                  title="Hide from composer"
                  aria-label={`Hide ${attachment.name}`}
                >
                  <FiX size={13} />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      <form className="composer" onSubmit={onSubmit}>
        <button type="button" className="icon-btn" onClick={openPicker} title="Pin PDFs">
          <HiOutlinePaperClip size={18} />
        </button>
        <label htmlFor="chat-input" className="sr-only">
          Message FlareGPT
        </label>
        <input
          ref={fileInputRef}
          className="hidden-file"
          type="file"
          accept="application/pdf"
          multiple
          onChange={async (event) => {
            await onFileChange(event);
            closeUploadModal();
          }}
        />
        <input
          id="chat-input"
          type="text"
          placeholder="Message FlareGPT"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          autoComplete="off"
          required
          disabled={composerLocked}
        />
        {microphoneEnabled ? (
          <button
            type="button"
            className={`icon-btn mic-btn ${isRecording ? "listening" : ""}`}
            onClick={toggleRecording}
            title={isRecording ? "Stop recording" : "Start recording"}
          >
            {isRecording ? <FiMicOff size={18} color="#ef4444" /> : <FiMic size={18} />}
          </button>
        ) : null}
        <button type="submit" className="send-btn" disabled={composerLocked} title="Send">
          <IoSend size={16} />
        </button>
      </form>

      <p className="disclaimer">
        FlareGPT can make mistakes. Please verify important information.
      </p>
    </div>
  );
}
