import { api, state } from "./app/state.js";
import {
  applyProfile,
  applySession,
  closeModal,
  openModal,
  openOfferModal,
  renderBoardDetail,
  renderBoardTags,
  renderBoards,
  renderListings,
  renderOffersInbox,
  renderPosts,
  renderTradeFeed,
  showView,
} from "./app/render.js";
import { appendChatMessage, clearMatchState, setupMatchHandlers } from "./app/match.js";

const views = document.querySelectorAll(".view");
const offerGrid = document.getElementById("offerGrid");
const boardList = document.getElementById("boardList");
const saveBoardList = document.getElementById("saveBoardList");
const offerModal = document.getElementById("offerModal");
const listingModal = document.getElementById("listingModal");
const postModal = document.getElementById("postModal");
const checkoutModal = document.getElementById("checkoutModal");
const boardModal = document.getElementById("boardModal");
const saveModal = document.getElementById("saveModal");
const boardDetailModal = document.getElementById("boardDetailModal");
const boardSearch = document.getElementById("boardSearch");
const saveProfile = document.getElementById("saveProfile");
const addListing = document.getElementById("addListing");
const saveListing = document.getElementById("saveListing");
const addPost = document.getElementById("addPost");
const savePost = document.getElementById("savePost");
const dropZone = document.getElementById("dropZone");
const postImage = document.getElementById("postImage");
const imagePreview = document.getElementById("imagePreview");
const addBoard = document.getElementById("addBoard");
const saveBoard = document.getElementById("saveBoard");
const chatInput = document.getElementById("chatInput");
const sendChat = document.getElementById("sendChat");
const openCheckout = document.getElementById("openCheckout");
const confirmCheckout = document.getElementById("confirmCheckout");
const offerScopeTabs = document.getElementById("offerScopeTabs");

function showImagePreview(file) {
  const reader = new FileReader();
  reader.onload = (event) => {
    imagePreview.src = event.target.result;
    dropZone.classList.add("has-preview");
  };
  reader.readAsDataURL(file);
}

function resetPreview() {
  imagePreview.src = "";
  dropZone.classList.remove("has-preview");
}

function openPrintWindow(payload) {
  const win = window.open("", "printWindow", "width=720,height=900");
  if (!win) return;
  win.document.write(`
    <html>
      <head>
        <title>Trade Shipping Labels</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; }
          h1 { font-size: 18px; margin-bottom: 12px; }
          .label { border: 1px dashed #999; padding: 16px; margin-bottom: 16px; }
          .label h2 { font-size: 14px; margin-bottom: 6px; }
          .row { margin-bottom: 4px; }
        </style>
      </head>
      <body>
        <h1>Trade Shipping Labels</h1>
        <div class="label">
          <h2>Your Package</h2>
          <div class="row"><strong>To:</strong> ${payload.matchName || "Match"}</div>
          <div class="row">${payload.matchAddress || "Address"}</div>
          <div class="row"><strong>Notes:</strong> ${payload.matchNotes || ""}</div>
        </div>
        <div class="label">
          <h2>Match Package</h2>
          <div class="row"><strong>To:</strong> ${payload.shipName || "You"}</div>
          <div class="row">${payload.shipAddress || "Address"}</div>
          <div class="row"><strong>Notes:</strong> ${payload.shipNotes || ""}</div>
        </div>
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

async function loadBoards() {
  state.boards = await api.get("/api/boards");
  renderBoards();
}

async function loadTradeFeed() {
  state.liveTradeFeed = await api.get("/api/feed/live");
  renderTradeFeed();
}

async function loadOffers() {
  state.offersInbox = await api.get(`/api/offers?scope=${state.offersScope}`);
  renderOffersInbox();
}

function stopTradeFeedPolling() {
  if (state.feedPollTimer) {
    clearInterval(state.feedPollTimer);
    state.feedPollTimer = null;
  }
}

function startTradeFeedPolling() {
  stopTradeFeedPolling();
  if (!state.isAuthenticated) return;
  state.feedPollTimer = setInterval(async () => {
    if (document.hidden || !state.isAuthenticated) return;
    try {
      await Promise.all([loadTradeFeed(), loadOffers()]);
    } catch (err) {
      // Keep the last rendered data and try again on the next interval.
    }
  }, 5000);
}

async function loadSession() {
  try {
    return await api.get("/api/session");
  } catch (err) {
    return { authenticated: false };
  }
}

async function handleChatSend() {
  const message = chatInput.value.trim();
  if (!message) return;
  if (!state.currentMatch) {
    alert("Match with someone first.");
    return;
  }
  appendChatMessage(message, "user");
  chatInput.value = "";
  if (state.chatTimer) clearTimeout(state.chatTimer);
  state.chatTimer = setTimeout(async () => {
    try {
      const reply = await api.post("/api/chat", { message });
      appendChatMessage(reply.reply, "match");
    } catch (err) {
      appendChatMessage("brb, connection lag", "match");
    }
  }, 500);
}

function getActiveViewIndex() {
  const swipeViews = ["landing", "online", "shop", "profile"];
  const active = Array.from(views).find((view) => view.classList.contains("active"));
  return swipeViews.indexOf(active?.id || "landing");
}

function swipeTo(delta) {
  const swipeViews = ["landing", "online", "shop", "profile"];
  const currentIndex = getActiveViewIndex();
  const nextIndex = currentIndex + delta;
  if (nextIndex < 0 || nextIndex >= swipeViews.length) return;
  showView(swipeViews[nextIndex]);
}

function isModalOpen() {
  return Array.from(document.querySelectorAll(".modal")).some(
    (modal) => modal.getAttribute("aria-hidden") === "false"
  );
}

function setupGeneralHandlers() {
  document.addEventListener("visibilitychange", async () => {
    if (!state.isAuthenticated) return;
    if (!document.hidden) {
      try {
        await Promise.all([loadTradeFeed(), loadOffers()]);
      } catch (err) {
        // Ignore transient refresh failures when the tab becomes visible.
      }
    }
  });

  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      showView(btn.dataset.view);
    });
  });

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const modal = document.getElementById(btn.dataset.close);
      if (modal) closeModal(modal);
    });
  });

  if (offerScopeTabs) {
    offerScopeTabs.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-offer-scope]");
      if (!button) return;
      state.offersScope = button.dataset.offerScope;
      try {
        await loadOffers();
      } catch (err) {
        alert("Unable to load offers right now.");
      }
    });
  }

  offerGrid.addEventListener("click", (event) => {
    const item = event.target.closest(".offer-item");
    if (!item) return;
    item.classList.toggle("selected");
  });

  document.getElementById("sendOffer").addEventListener("click", async () => {
    if (!state.currentMatch?.id) {
      alert("Match with someone first.");
      return;
    }
    const selected = Array.from(document.querySelectorAll(".offer-item.selected"));
    if (!selected.length) {
      alert("Select at least one item to offer.");
      return;
    }
    const selectedPostIds = selected
      .map((item) => Number(item.dataset.postId))
      .filter((value) => Number.isInteger(value) && value > 0);
    if (!selectedPostIds.length) {
      alert("Select valid posts to offer.");
      return;
    }
    try {
      const offer = await api.post("/api/offers", {
        matchId: state.currentMatch.id,
        selectedPostIds,
      });
      await Promise.all([loadTradeFeed(), loadOffers()]);
      closeModal(offerModal);
      const titles = (offer.selectedPosts || []).map((post) => post.title).join(", ");
      appendChatMessage(`sent an offer with: ${titles || `${selectedPostIds.length} items`}`, "user");
      alert("Offer sent and saved.");
    } catch (err) {
      alert("Unable to send offer right now.");
    }
  });

  document.getElementById("postGrid").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-offer]");
    if (btn) {
      openOfferModal(Number(btn.dataset.offer));
      return;
    }
    const saveBtn = event.target.closest("[data-save]");
    if (saveBtn) {
      state.pendingSavePostId = Number(saveBtn.dataset.save);
      openModal(saveModal);
    }
  });

  document.getElementById("listingGrid").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-offer-listing]");
    if (!btn) return;
    openOfferModal();
  });

  boardList.addEventListener("click", async (event) => {
    const item = event.target.closest(".board-item");
    if (!item) return;
    const boardId = Number(item.dataset.boardId);
    const board = state.boards.find((entry) => entry.id === boardId);
    if (!board) return;
    try {
      state.currentBoardPosts = await api.get(`/api/boards/${boardId}/posts`);
      state.boardFilter = { query: "", tag: "" };
      boardSearch.value = "";
      renderBoardTags(state.currentBoardPosts);
      renderBoardDetail(board, state.currentBoardPosts);
      openModal(boardDetailModal);
    } catch (err) {
      alert("Unable to load board.");
    }
  });

  boardSearch.addEventListener("input", () => {
    state.boardFilter.query = boardSearch.value.trim();
    const boardId = Number(document.getElementById("boardDetailTitle").dataset.boardId);
    const board = state.boards.find((entry) => entry.id === boardId);
    if (board) renderBoardDetail(board, state.currentBoardPosts);
  });

  saveBoardList.addEventListener("click", async (event) => {
    const item = event.target.closest(".board-item");
    if (!item) return;
    const boardId = Number(item.dataset.boardId);
    if (!boardId || !state.pendingSavePostId) return;
    try {
      await api.post(`/api/boards/${boardId}/posts`, { postId: state.pendingSavePostId });
      state.pendingSavePostId = null;
      closeModal(saveModal);
      await loadBoards();
    } catch (err) {
      alert("Unable to save to board.");
    }
  });

  saveProfile.addEventListener("click", async () => {
    if (!state.isAuthenticated) {
      alert("Sign in to edit your profile.");
      return;
    }
    const nameValue = document.getElementById("nameInput").value.trim() || "your.handle";
    const bioValue = document.getElementById("bioInput").value.trim() || "Tell people your vibe.";
    const tagsValue = document
      .getElementById("tagsInput")
      .value.split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    try {
      state.profile = await api.put("/api/profile", {
        name: nameValue,
        bio: bioValue,
        tags: tagsValue,
      });
      applyProfile();
    } catch (err) {
      alert("Unable to save profile.");
    }
  });

  addListing.addEventListener("click", () => openModal(listingModal));
  saveListing.addEventListener("click", async () => {
    const title = document.getElementById("listingTitle").value.trim();
    const vibe = document.getElementById("listingVibe").value.trim();
    const wants = document.getElementById("listingWants").value.trim();
    if (!title || !wants) {
      alert("Add a title and what you want in return.");
      return;
    }
    try {
      const listing = await api.post("/api/listings", { title, vibe, wants });
      state.listings.unshift(listing);
      renderListings();
      closeModal(listingModal);
      document.getElementById("listingTitle").value = "";
      document.getElementById("listingVibe").value = "";
      document.getElementById("listingWants").value = "";
    } catch (err) {
      alert("Unable to add listing.");
    }
  });

  addPost.addEventListener("click", () => openModal(postModal));
  dropZone.addEventListener("click", () => postImage.click());
  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
  });
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragover");
    const file = event.dataTransfer.files[0];
    if (file) {
      postImage.files = event.dataTransfer.files;
      showImagePreview(file);
    }
  });
  postImage.addEventListener("change", () => {
    const file = postImage.files[0];
    if (file) showImagePreview(file);
  });
  savePost.addEventListener("click", async () => {
    const title = document.getElementById("postTitle").value.trim();
    const desc = document.getElementById("postDesc").value.trim();
    const items = document
      .getElementById("postItems")
      .value.split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const image = postImage.files[0];
    if (!title || !items.length) {
      alert("Add a title and at least one item.");
      return;
    }
    try {
      const formData = new FormData();
      formData.append("title", title);
      formData.append("desc", desc);
      formData.append("items", items.join(", "));
      if (image) formData.append("image", image);
      const post = await api.postForm("/api/posts", formData);
      state.posts.unshift(post);
      renderPosts();
      closeModal(postModal);
      document.getElementById("postTitle").value = "";
      document.getElementById("postDesc").value = "";
      document.getElementById("postItems").value = "";
      postImage.value = "";
      resetPreview();
    } catch (err) {
      alert("Unable to add post.");
    }
  });

  addBoard.addEventListener("click", () => openModal(boardModal));
  saveBoard.addEventListener("click", async () => {
    const name = document.getElementById("boardName").value.trim();
    const description = document.getElementById("boardDesc").value.trim();
    if (!name) {
      alert("Board name required.");
      return;
    }
    try {
      const board = await api.post("/api/boards", { name, description });
      state.boards.unshift(board);
      renderBoards();
      closeModal(boardModal);
      document.getElementById("boardName").value = "";
      document.getElementById("boardDesc").value = "";
    } catch (err) {
      alert("Unable to create board.");
    }
  });

  sendChat.addEventListener("click", handleChatSend);
  chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") handleChatSend();
  });

  openCheckout.addEventListener("click", () => openModal(checkoutModal));
  confirmCheckout.addEventListener("click", async () => {
    try {
      const payload = {
        shipName: document.getElementById("shipName").value.trim(),
        shipAddress: document.getElementById("shipAddress").value.trim(),
        shipNotes: document.getElementById("shipNotes").value.trim(),
        matchName: document.getElementById("matchNameInput").value.trim(),
        matchAddress: document.getElementById("matchAddress").value.trim(),
        matchNotes: document.getElementById("matchNotes").value.trim(),
      };
      await api.post("/api/checkout", payload);
      closeModal(checkoutModal);
      openPrintWindow(payload);
    } catch (err) {
      alert("Unable to start checkout.");
    }
  });

  let touchStartX = null;
  let touchStartY = null;
  window.addEventListener("touchstart", (event) => {
    if (isModalOpen()) return;
    const target = event.target;
    if (target.closest("input") || target.closest("textarea")) return;
    touchStartX = event.touches[0].clientX;
    touchStartY = event.touches[0].clientY;
  });
  window.addEventListener("touchend", (event) => {
    if (touchStartX === null || touchStartY === null) return;
    const dx = event.changedTouches[0].clientX - touchStartX;
    const dy = event.changedTouches[0].clientY - touchStartY;
    touchStartX = null;
    touchStartY = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
    swipeTo(dx < 0 ? 1 : -1);
  });
}

async function init() {
  try {
    const session = await loadSession();
    applySession(session);

    if (!session.authenticated) {
      stopTradeFeedPolling();
      renderListings();
      renderPosts();
      renderBoards();
      renderTradeFeed();
      renderOffersInbox();
      clearMatchState();
      return;
    }

    const [listData, postData, profileData, boardData, tradeFeedData, offersData] = await Promise.all([
      api.get("/api/listings"),
      api.get("/api/posts"),
      api.get("/api/profile"),
      api.get("/api/boards"),
      api.get("/api/feed/live"),
      api.get(`/api/offers?scope=${state.offersScope}`),
    ]);
    state.listings = listData;
    state.posts = postData;
    state.profile = profileData;
    state.boards = boardData;
    state.liveTradeFeed = tradeFeedData;
    state.offersInbox = offersData;
    renderListings();
    renderPosts();
    applyProfile();
    renderBoards();
    renderTradeFeed();
    renderOffersInbox();
    startTradeFeedPolling();
    clearMatchState();
  } catch (err) {
    alert("Server not reachable. Start the backend server first.");
  }
}

setupGeneralHandlers();
setupMatchHandlers(async () => {
  await Promise.all([loadTradeFeed(), loadOffers()]);
});
init();
