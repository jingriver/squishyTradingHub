import { api, state } from "./state.js";
import { openModal, openOfferModal, showView } from "./render.js";

const matchModal = document.getElementById("matchModal");
const acceptMatchBtn = document.getElementById("acceptMatch");
const declineMatchBtn = document.getElementById("declineMatch");

function syncMatchButtons() {
  const hasMatch = Boolean(state.currentMatch?.id);
  if (acceptMatchBtn) {
    acceptMatchBtn.disabled = !hasMatch || state.currentMatch?.status === "accepted";
  }
  if (declineMatchBtn) {
    declineMatchBtn.disabled = !hasMatch;
  }
}

export function clearMatchState(message = "Tap Match Me Now or Enter Trading Hub to find someone.") {
  state.currentMatch = null;
  stopMatchPolling();
  document.getElementById("matchStatus").textContent = "Waiting...";
  document.getElementById("matchCard").innerHTML = `<p class="muted">${message}</p>`;
  document.getElementById("chatStatus").textContent = "Offline";
  document.getElementById("matchNameInput").value = "";
  syncMatchButtons();
}

function stopMatchPolling() {
  if (state.matchPollTimer) {
    clearTimeout(state.matchPollTimer);
    state.matchPollTimer = null;
  }
}

function scheduleMatchPoll() {
  stopMatchPolling();
  state.matchPollTimer = setTimeout(() => {
    matchNow();
  }, 3000);
}

export function appendChatMessage(text, sender = "match") {
  const chatMessages = document.getElementById("chatMessages");
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${sender}`;
  bubble.innerHTML = `
    <div>${text}</div>
    <div class="chat-meta">${sender === "user" ? "you" : state.currentMatch?.name || "match"}</div>
  `;
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function seedChat(match) {
  const chatMessages = document.getElementById("chatMessages");
  chatMessages.innerHTML = "";
  appendChatMessage(match.opener || "hi! interested in trading?", "match");
}

function renderWaitingMatch() {
  state.currentMatch = null;
  document.getElementById("matchStatus").textContent = "Searching...";
  document.getElementById("matchCard").innerHTML = `
    <h4>Looking for a live trader</h4>
    <p class="muted">You are in the matchmaking queue. Keep this tab open while we find someone.</p>
  `;
  document.getElementById("chatStatus").textContent = "Waiting";
  syncMatchButtons();
}

function applyMatch(match) {
  const isNewMatch = state.currentMatch?.id !== match.id;
  state.currentMatch = match;
  stopMatchPolling();
  document.getElementById("matchStatus").textContent = match.status === "accepted" ? "Accepted" : "Matched";
  document.getElementById("matchCard").innerHTML = `
    <h4>${match.name}</h4>
    <p class="muted">${match.vibe}</p>
    <p><strong>${match.wants}</strong></p>
  `;
  document.getElementById("matchName").textContent = match.name;
  document.getElementById("matchVibe").textContent = match.vibe;
  document.getElementById("matchNameInput").value = match.name;
  document.getElementById("matchTags").innerHTML = match.tags.map((tag) => `<span class="tag">${tag}</span>`).join("");
  document.getElementById("chatStatus").textContent = match.status === "accepted" ? "Ready" : "Online";
  syncMatchButtons();
  if (isNewMatch) {
    seedChat(match);
    openModal(matchModal);
  }
}

export async function matchNow() {
  try {
    const match = await api.post("/api/match");
    if (match.waiting) {
      renderWaitingMatch();
      scheduleMatchPoll();
      return;
    }
    applyMatch(match);
  } catch (err) {
    stopMatchPolling();
    alert("Unable to match right now. Is the server running?");
  }
}

export function setupMatchHandlers(refreshTradeFeed = async () => {}) {
  document.getElementById("matchNow").addEventListener("click", matchNow);
  document.getElementById("enterHub").addEventListener("click", () => {
    showView("online");
    matchNow();
  });
  document.getElementById("openOffer").addEventListener("click", () => {
    if (!state.currentMatch) {
      alert("Match with someone first.");
      return;
    }
    openOfferModal();
  });

  if (acceptMatchBtn) {
    acceptMatchBtn.addEventListener("click", async () => {
      if (!state.currentMatch?.id) {
        alert("Match with someone first.");
        return;
      }
      try {
        const match = await api.post("/api/match/action", {
          matchId: state.currentMatch.id,
          action: "accept",
        });
        applyMatch(match);
        await refreshTradeFeed();
        alert("Trade accepted.");
      } catch (err) {
        alert("Unable to accept the trade right now.");
      }
    });
  }

  if (declineMatchBtn) {
    declineMatchBtn.addEventListener("click", async () => {
      if (!state.currentMatch?.id) {
        alert("Match with someone first.");
        return;
      }
      try {
        await api.post("/api/match/action", {
          matchId: state.currentMatch.id,
          action: "decline",
        });
        clearMatchState("Trade declined. Match again when you're ready.");
      } catch (err) {
        alert("Unable to decline the trade right now.");
      }
    });
  }
}
