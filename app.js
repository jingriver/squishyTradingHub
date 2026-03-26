const views = document.querySelectorAll(".view");
const tabs = document.querySelectorAll(".tab");

let listings = [];
let posts = [];
let profile = null;
let boards = [];
let pendingSavePostId = null;
let currentBoardPosts = [];
let boardFilter = { query: "", tag: "" };

let isAuthenticated = false;

const listingGrid = document.getElementById("listingGrid");
const postGrid = document.getElementById("postGrid");
const offerGrid = document.getElementById("offerGrid");
const boardList = document.getElementById("boardList");
const saveBoardList = document.getElementById("saveBoardList");
const authUser = document.getElementById("authUser");
const authName = document.getElementById("authName");
const authEmail = document.getElementById("authEmail");
const authAvatar = document.getElementById("authAvatar");
const googleAuth = document.getElementById("googleAuth");
const logoutBtn = document.getElementById("logoutBtn");
const profileAvatar = document.getElementById("profileAvatar");

const api = {
  async request(path, options = {}) {
    const response = await fetch(path, options);
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || "Request failed");
    }
    return response.json();
  },
  get(path) {
    return this.request(path);
  },
  post(path, body) {
    return this.request(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body || {}),
    });
  },
  postForm(path, formData) {
    return this.request(path, {
      method: "POST",
      body: formData,
    });
  },
  put(path, body) {
    return this.request(path, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body || {}),
    });
  },
};

function showView(id) {
  const restrictedViews = ["online", "shop", "profile"];
  if (restrictedViews.includes(id) && !isAuthenticated) {
    window.location.href = "login.html";
    return;
  }

  views.forEach((view) => {
    view.classList.toggle("active", view.id === id);
  });
  tabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view === id);
  });
}

document.querySelectorAll("[data-view]").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    const targetView = btn.dataset.view;
    showView(targetView);
  });
});

function renderListings() {
  listingGrid.innerHTML = "";
  listings.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "listing";
    card.innerHTML = `
      <div class="title">${item.title}</div>
      <p class="muted">${item.vibe}</p>
      <p><strong>Looking for:</strong> ${item.wants}</p>
      <button class="ghost" data-offer-listing="${index}">Offer Trade</button>
    `;
    listingGrid.appendChild(card);
  });
}

function renderPosts() {
  postGrid.innerHTML = "";
  offerGrid.innerHTML = "";
  posts.forEach((post, index) => {
    const card = document.createElement("div");
    card.className = "feed-card";
    card.innerHTML = `
      <div class="feed-media">
        ${post.imageUrl ? `<img src="${post.imageUrl}" alt="${post.title}" />` : "Upload a photo for this post."}
      </div>
      <div>
        <p class="title">${post.title}</p>
        <p class="muted">${post.desc}</p>
      </div>
      <div class="tag-row">${post.items
        .map((item) => `<span class="tag">${item}</span>`)
        .join("")}</div>
      <div class="feed-actions">
        <span>${post.likes} likes</span>
        <div class="cta-row">
          <button class="ghost" data-offer="${index}">Offer</button>
          <button class="ghost" data-save="${post.id}">Save</button>
        </div>
      </div>
    `;
    postGrid.appendChild(card);

    const offerItem = document.createElement("div");
    offerItem.className = "offer-item";
    offerItem.dataset.index = index;
    offerItem.innerHTML = `
      <strong>${post.title}</strong>
      <p>${post.items.join(", ")}</p>
    `;
    offerGrid.appendChild(offerItem);
  });
}

function renderBoards() {
  boardList.innerHTML = "";
  saveBoardList.innerHTML = "";
  if (!boards.length) {
    boardList.innerHTML = `<p class="muted">No boards yet. Create your first one.</p>`;
    return;
  }
  boards.forEach((board) => {
    const item = document.createElement("div");
    item.className = "board-item";
    item.dataset.boardId = board.id;
    item.innerHTML = `
      <div>
        <strong>${board.name}</strong>
        <small>${board.itemCount || 0} saved</small>
      </div>
      <span>â€º</span>
    `;
    boardList.appendChild(item);

    const saveItem = document.createElement("div");
    saveItem.className = "board-item";
    saveItem.dataset.boardId = board.id;
    saveItem.innerHTML = `
      <div>
        <strong>${board.name}</strong>
        <small>${board.description || "No description"}</small>
      </div>
      <span>Save</span>
    `;
    saveBoardList.appendChild(saveItem);
  });
}

function updateProfileTags(tags) {
  const tagWrap = document.getElementById("profileTags");
  tagWrap.innerHTML = "";
  tags.forEach((tag) => {
    const span = document.createElement("span");
    span.className = "tag";
    span.textContent = tag;
    tagWrap.appendChild(span);
  });
}

function applyProfile() {
  if (!profile) return;
  document.getElementById("profileName").textContent = profile.name;
  document.getElementById("profileBio").textContent = profile.bio;
  document.getElementById("profileAvatar").textContent = profile.name.slice(0, 1).toUpperCase();
  document.getElementById("nameInput").value = profile.name;
  document.getElementById("bioInput").value = profile.bio;
  document.getElementById("tagsInput").value = profile.tags.join(", ");
  updateProfileTags(profile.tags);
}

function setProfileEditState(enabled) {
  const nameInput = document.getElementById("nameInput");
  const bioInput = document.getElementById("bioInput");
  const tagsInput = document.getElementById("tagsInput");
  const saveProfileBtn = document.getElementById("saveProfile");
  if (nameInput) nameInput.disabled = !enabled;
  if (bioInput) bioInput.disabled = !enabled;
  if (tagsInput) tagsInput.disabled = !enabled;
  if (saveProfileBtn) saveProfileBtn.disabled = !enabled;
  if (saveProfileBtn) {
    saveProfileBtn.textContent = enabled ? "Save Profile" : "Sign in to edit";
  }
}

function applySession(session) {
  isAuthenticated = Boolean(session?.authenticated && session.user);
  setProfileEditState(isAuthenticated);
  
  const restrictedViews = ["online", "shop", "profile"];
  const currentView = Array.from(views).find(v => v.classList.contains("active"))?.id;
  
  if (!isAuthenticated && restrictedViews.includes(currentView)) {
    showView("landing");
  }

  const topLoginBtn = document.getElementById("topLoginBtn");
  const topUserMenu = document.getElementById("topUserMenu");
  const topAvatar = document.getElementById("topAvatar");
  
  if (topLoginBtn) topLoginBtn.hidden = isAuthenticated;
  if (topUserMenu) topUserMenu.hidden = !isAuthenticated;
  
  if (isAuthenticated && session?.user && topAvatar) {
    topAvatar.src = session.user.picture || "";
  }

  if (!authUser || !googleAuth || !logoutBtn) return;
  if (session?.authenticated && session.user) {
    authUser.hidden = false;
    googleAuth.hidden = true;
    logoutBtn.hidden = false;
    authName.textContent = session.user.name || "Google User";
    authEmail.textContent = session.user.email || "";
    if (session.user.picture) {
      authAvatar.src = session.user.picture;
      authAvatar.hidden = false;
      if (profileAvatar) {
        profileAvatar.textContent = "";
        profileAvatar.style.backgroundImage = `url("${session.user.picture}")`;
        profileAvatar.classList.add("has-image");
      }
    } else {
      authAvatar.removeAttribute("src");
      authAvatar.hidden = true;
      if (profileAvatar) {
        profileAvatar.style.backgroundImage = "";
        profileAvatar.classList.remove("has-image");
      }
    }
    return;
  }
  authUser.hidden = true;
  googleAuth.hidden = false;
  logoutBtn.hidden = true;
  if (profileAvatar) {
    profileAvatar.style.backgroundImage = "";
    profileAvatar.classList.remove("has-image");
  }
}

const matchModal = document.getElementById("matchModal");
const offerModal = document.getElementById("offerModal");
const listingModal = document.getElementById("listingModal");
const postModal = document.getElementById("postModal");
const checkoutModal = document.getElementById("checkoutModal");
const boardModal = document.getElementById("boardModal");
const saveModal = document.getElementById("saveModal");
const boardDetailModal = document.getElementById("boardDetailModal");

function openModal(modal) {
  modal.setAttribute("aria-hidden", "false");
}

function closeModal(modal) {
  modal.setAttribute("aria-hidden", "true");
}

document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const modal = document.getElementById(btn.dataset.close);
    if (modal) closeModal(modal);
  });
});

function openOfferModal(preselectIndex = null) {
  offerGrid.querySelectorAll(".offer-item").forEach((item) => item.classList.remove("selected"));
  openModal(offerModal);
  if (preselectIndex !== null) {
    requestAnimationFrame(() => {
      const target = offerGrid.querySelector(`[data-index="${preselectIndex}"]`);
      if (target) target.classList.add("selected");
    });
  }
}

let currentMatch = null;
let chatTimer = null;

function appendChatMessage(text, sender = "match") {
  const chatMessages = document.getElementById("chatMessages");
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${sender}`;
  bubble.innerHTML = `
    <div>${text}</div>
    <div class="chat-meta">${sender === "user" ? "you" : currentMatch?.name || "match"}</div>
  `;
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function seedChat(match) {
  const chatMessages = document.getElementById("chatMessages");
  chatMessages.innerHTML = "";
  appendChatMessage(match.opener || "hi! interested in trading?", "match");
}

async function matchNow() {
  try {
    const match = await api.post("/api/match");
    currentMatch = match;
    const matchCard = document.getElementById("matchCard");
    const matchStatus = document.getElementById("matchStatus");
    matchStatus.textContent = "Matched";
    matchCard.innerHTML = `
      <h4>${match.name}</h4>
      <p class="muted">${match.vibe}</p>
      <p><strong>${match.wants}</strong></p>
    `;
    document.getElementById("matchName").textContent = match.name;
    document.getElementById("matchVibe").textContent = match.vibe;
    const matchTags = document.getElementById("matchTags");
    matchTags.innerHTML = match.tags.map((tag) => `<span class="tag">${tag}</span>`).join("");
    document.getElementById("chatStatus").textContent = "Online";
    seedChat(match);
    openModal(matchModal);
  } catch (err) {
    alert("Unable to match right now. Is the server running?");
  }
}

document.getElementById("matchNow").addEventListener("click", matchNow);

document.getElementById("enterHub").addEventListener("click", () => {
  showView("online");
  matchNow();
});

document.getElementById("openOffer").addEventListener("click", () => {
  openOfferModal();
});

document.getElementById("sendOffer").addEventListener("click", () => {
  const selected = Array.from(document.querySelectorAll(".offer-item.selected"));
  if (!selected.length) {
    alert("Select at least one item to offer.");
    return;
  }
  closeModal(offerModal);
  alert("Offer sent! Waiting for response.");
});

offerGrid.addEventListener("click", (event) => {
  const item = event.target.closest(".offer-item");
  if (!item) return;
  item.classList.toggle("selected");
});

postGrid.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-offer]");
  if (btn) {
    const index = Number(btn.dataset.offer);
    openOfferModal(index);
    return;
  }
  const saveBtn = event.target.closest("[data-save]");
  if (saveBtn) {
    pendingSavePostId = Number(saveBtn.dataset.save);
    openModal(saveModal);
  }
});

boardList.addEventListener("click", async (event) => {
  const item = event.target.closest(".board-item");
  if (!item) return;
  const boardId = Number(item.dataset.boardId);
  const board = boards.find((b) => b.id === boardId);
  if (!board) return;
  try {
    currentBoardPosts = await api.get(`/api/boards/${boardId}/posts`);
    boardFilter = { query: "", tag: "" };
    document.getElementById("boardSearch").value = "";
    renderBoardTags(currentBoardPosts);
    renderBoardDetail(board, currentBoardPosts);
    openModal(boardDetailModal);
  } catch (err) {
    alert("Unable to load board.");
  }
});

function renderBoardTags(boardPosts) {
  const tagWrap = document.getElementById("boardTags");
  const tags = new Set();
  boardPosts.forEach((post) => {
    post.items.forEach((item) => tags.add(item));
  });
  tagWrap.innerHTML = "";
  Array.from(tags).forEach((tag) => {
    const btn = document.createElement("button");
    btn.textContent = tag;
    if (boardFilter.tag === tag) btn.classList.add("active");
    btn.addEventListener("click", () => {
      boardFilter.tag = boardFilter.tag === tag ? "" : tag;
      renderBoardTags(currentBoardPosts);
      const boardId = Number(document.getElementById("boardDetailTitle").dataset.boardId);
      const board = boards.find((b) => b.id === boardId);
      if (board) renderBoardDetail(board, currentBoardPosts);
    });
    tagWrap.appendChild(btn);
  });
}

function renderBoardDetail(board, boardPosts) {
  const title = document.getElementById("boardDetailTitle");
  title.textContent = board.name;
  title.dataset.boardId = board.id;
  document.getElementById("boardDetailDesc").textContent = board.description || "";
  const grid = document.getElementById("boardDetailGrid");
  const query = boardFilter.query.toLowerCase();
  const filtered = boardPosts.filter((post) => {
    const matchesTag = boardFilter.tag ? post.items.includes(boardFilter.tag) : true;
    const text = `${post.title} ${post.desc} ${post.items.join(" ")}`.toLowerCase();
    const matchesQuery = query ? text.includes(query) : true;
    return matchesTag && matchesQuery;
  });

  grid.innerHTML = "";
  if (!filtered.length) {
    grid.innerHTML = `<p class="muted">No posts match the filter.</p>`;
    return;
  }
  filtered.forEach((post) => {
    const card = document.createElement("div");
    card.className = "board-card";
    card.innerHTML = `
      ${post.imageUrl ? `<img src="${post.imageUrl}" alt="${post.title}" />` : ""}
      <div class="card-body">
        <strong>${post.title}</strong>
        <p class="muted">${post.desc}</p>
      </div>
    `;
    grid.appendChild(card);
  });
}

const boardSearch = document.getElementById("boardSearch");
boardSearch.addEventListener("input", () => {
  boardFilter.query = boardSearch.value.trim();
  const boardId = Number(document.getElementById("boardDetailTitle").dataset.boardId);
  const board = boards.find((b) => b.id === boardId);
  if (board) renderBoardDetail(board, currentBoardPosts);
});

saveBoardList.addEventListener("click", async (event) => {
  const item = event.target.closest(".board-item");
  if (!item) return;
  const boardId = Number(item.dataset.boardId);
  if (!boardId || !pendingSavePostId) return;
  try {
    await api.post(`/api/boards/${boardId}/posts`, { postId: pendingSavePostId });
    pendingSavePostId = null;
    closeModal(saveModal);
    await loadBoards();
  } catch (err) {
    alert("Unable to save to board.");
  }
});

listingGrid.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-offer-listing]");
  if (!btn) return;
  openOfferModal();
});

const saveProfile = document.getElementById("saveProfile");

saveProfile.addEventListener("click", async () => {
  if (!isAuthenticated) {
    alert("Sign in to edit your profile.");
    return;
  }

  const nameValue = document.getElementById("nameInput").value.trim() || "your.handle";
  const bioValue = document.getElementById("bioInput").value.trim() || "Tell people your vibe.";
  const tagsValue = document.getElementById("tagsInput").value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  try {
    profile = await api.put("/api/profile", {
      name: nameValue,
      bio: bioValue,
      tags: tagsValue,
    });
    applyProfile();
  } catch (err) {
    alert("Unable to save profile.");
  }
});

const addListing = document.getElementById("addListing");
const saveListing = document.getElementById("saveListing");

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
    const listing = await api.post("/api/listings", {
      title,
      vibe,
      wants,
    });
    listings.unshift(listing);
    renderListings();
    closeModal(listingModal);
    document.getElementById("listingTitle").value = "";
    document.getElementById("listingVibe").value = "";
    document.getElementById("listingWants").value = "";
  } catch (err) {
    alert("Unable to add listing.");
  }
});

const addPost = document.getElementById("addPost");
const savePost = document.getElementById("savePost");
const dropZone = document.getElementById("dropZone");
const postImage = document.getElementById("postImage");
const imagePreview = document.getElementById("imagePreview");

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
    posts.unshift(post);
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

const addBoard = document.getElementById("addBoard");
const saveBoard = document.getElementById("saveBoard");

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
    boards.unshift(board);
    renderBoards();
    closeModal(boardModal);
    document.getElementById("boardName").value = "";
    document.getElementById("boardDesc").value = "";
  } catch (err) {
    alert("Unable to create board.");
  }
});

const chatInput = document.getElementById("chatInput");
const sendChat = document.getElementById("sendChat");

async function handleChatSend() {
  const message = chatInput.value.trim();
  if (!message) return;
  if (!currentMatch) {
    alert("Match with someone first.");
    return;
  }
  appendChatMessage(message, "user");
  chatInput.value = "";
  if (chatTimer) clearTimeout(chatTimer);
  chatTimer = setTimeout(async () => {
    try {
      const reply = await api.post("/api/chat", { message });
      appendChatMessage(reply.reply, "match");
    } catch (err) {
      appendChatMessage("brb, connection lag", "match");
    }
  }, 500);
}

sendChat.addEventListener("click", handleChatSend);
chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") handleChatSend();
});

const openCheckout = document.getElementById("openCheckout");
const confirmCheckout = document.getElementById("confirmCheckout");

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

const swipeViews = ["landing", "online", "shop", "profile"];
let touchStartX = null;
let touchStartY = null;

function getActiveViewIndex() {
  const active = Array.from(views).find((view) => view.classList.contains("active"));
  return swipeViews.indexOf(active?.id || "landing");
}

function swipeTo(delta) {
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

async function loadBoards() {
  boards = await api.get("/api/boards");
  renderBoards();
}

async function loadSession() {
  try {
    const session = await api.get("/api/session");
    applySession(session);
  } catch (err) {
    applySession({ authenticated: false });
  }
}

async function init() {
  try {
    const [listData, postData, profileData] = await Promise.all([
      api.get("/api/listings"),
      api.get("/api/posts"),
      api.get("/api/profile"),
    ]);
    listings = listData;
    posts = postData;
    profile = profileData;
    renderListings();
    renderPosts();
    applyProfile();
    await loadBoards();
    await loadSession();
  } catch (err) {
    alert("Server not reachable. Start the backend server first.");
  }
}

init();
