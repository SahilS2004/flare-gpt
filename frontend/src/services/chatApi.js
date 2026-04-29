import { getStoredUser } from "./auth";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";

function getAuthHeaders() {
  const user = getStoredUser();
  const token = user?.token;
  return {
    "Content-Type": "application/json",
    ...(token ? { "Authorization": `Bearer ${token}` } : {})
  };
}

export async function sendMessage(message, chatId = null) {
  const res = await fetch(`${API}/chat`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ message, ...(chatId && { chatId }) })
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error("Unauthorized. Please log in again.");
    throw new Error("Failed to send message");
  }
  // Return the stream directly for the frontend to process
  return res.body; 
}

export async function fetchHistory() {
  const res = await fetch(`${API}/history`, {
    method: "GET",
    headers: getAuthHeaders()
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error("Unauthorized");
    throw new Error("Failed to fetch history");
  }
  return res.json();
}

export async function fetchChatMessages(chatId) {
  const res = await fetch(`${API}/history/${chatId}`, {
    method: "GET",
    headers: getAuthHeaders()
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error("Unauthorized");
    throw new Error("Failed to fetch messages");
  }
  return res.json();
}

export async function deleteChat(chatId) {
  const res = await fetch(`${API}/history/${chatId}`, {
    method: "DELETE",
    headers: getAuthHeaders()
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error("Unauthorized");
    throw new Error("Failed to delete chat");
  }
  return res.json();
}

export async function transcribeAudio(audioBlob) {
  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.webm");

  const res = await fetch(`${API}/transcribe`, {
    method: "POST",
    headers: {
      ...(getStoredUser()?.token ? { "Authorization": `Bearer ${getStoredUser().token}` } : {})
    },
    body: formData
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error("Unauthorized");
    throw new Error("Failed to transcribe audio");
  }

  return res.json();
}

export async function uploadDocument(file, chatId = null) {
  const formData = new FormData();
  formData.append("file", file);
  if (chatId) formData.append("chatId", chatId);

  const res = await fetch(`${API}/upload-document`, {
    method: "POST",
    headers: {
      ...(getStoredUser()?.token ? { "Authorization": `Bearer ${getStoredUser().token}` } : {})
    },
    body: formData
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error("Unauthorized");
    throw new Error("Failed to upload document");
  }

  return res.json();
}

/** Poll indexing progress after async upload/indexing pipeline. */
export async function fetchDocumentStatus(documentId) {
  const res = await fetch(
    `${API}/document-status/${encodeURIComponent(documentId)}`,
    {
      method: "GET",
      headers: getAuthHeaders()
    }
  );

  if (!res.ok) {
    if (res.status === 401) throw new Error("Unauthorized");
    throw new Error("Failed to fetch document status");
  }

  return res.json();
}

export async function fetchUserSettings() {
  const res = await fetch(`${API}/settings`, {
    method: "GET",
    headers: getAuthHeaders()
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error("Unauthorized");
    throw new Error("Failed to fetch settings");
  }

  return res.json();
}

export async function updateUserSettings(settings) {
  const res = await fetch(`${API}/settings`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(settings)
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error("Unauthorized");
    throw new Error("Failed to update settings");
  }

  return res.json();
}