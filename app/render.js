import { state } from "./state.js";

const views = document.querySelectorAll(".view");
const tabs = document.querySelectorAll(".tab");
const listingGrid = document.getElementById("listingGrid");
const postGrid = document.getElementById("postGrid");
const offerGrid = document.getElementById("offerGrid");
const boardList = document.getElementById("boardList");
const saveBoardList = document.getElementById("saveBoardList");
const liveTradeFeedPanel = document.getElementById("liveTradeFeedPanel");
const offersInboxPanel = document.getElementById("offersInboxPanel");
const offersInboxList = document.getElementById("offersInboxList");
const offerScopeTabs = document.getElementById("offerScopeTabs");
const authUser = document.getElementById("authUser");
const authName = document.getElementById("authName");
const authEmail = document.getElementById("authEmail");
const authAvatar = document.getElementById("authAvatar");
const googleAuth = document.getElementById("googleAuth");
const logoutBtn = document.getElementById("logoutBtn");
const profileAvatar = document.getElementById("profileAvatar");

export function showView(id) {
  const restrictedViews = ["online", "shop", "profile"];
  if (restrictedViews.includes(id) && !state.isAuthenticated) {
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

export function renderListings() {
  listingGrid.innerHTML = "";
  state.listings.forEach((item, index) => {
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

export function renderPosts() {
  postGrid.innerHTML = "";
  offerGrid.innerHTML = "";
  state.posts.forEach((post, index) => {
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
      <div class="tag-row">${post.items.map((item) => `<span class="tag">${item}</span>`).join("")}</div>
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
    offerItem.dataset.postId = post.id;
    offerItem.innerHTML = `
      <strong>${post.title}</strong>
      <p>${post.items.join(", ")}</p>
    `;
    offerGrid.appendChild(offerItem);
  });
}

export function renderBoards() {
  boardList.innerHTML = "";
  saveBoardList.innerHTML = "";
  if (!state.boards.length) {
    boardList.innerHTML = `<p class="muted">No boards yet. Create your first one.</p>`;
    return;
  }
  state.boards.forEach((board) => {
    const item = document.createElement("div");
    item.className = "board-item";
    item.dataset.boardId = board.id;
    item.innerHTML = `
      <div>
        <strong>${board.name}</strong>
        <small>${board.itemCount || 0} saved</small>
      </div>
      <span>&rsaquo;</span>
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

function formatRelativeTime(value) {
  const timestamp = new Date(value).getTime();
  if (!timestamp) return "just now";
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.max(1, Math.floor(diffMs / 60000));
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

export function renderTradeFeed() {
  if (!liveTradeFeedPanel) return;
  const items = state.liveTradeFeed.length
    ? state.liveTradeFeed
        .map(
          (item) => `
            <div class="feed-item">
              <div class="feed-avatar">${item.actorInitial || "T"}</div>
              <div>
                <p><strong>${item.actorName}</strong> ${item.message.replace(`${item.actorName} `, "")}</p>
                <span>${formatRelativeTime(item.createdAt)}</span>
              </div>
            </div>
          `
        )
        .join("")
    : `<p class="muted">No live trade activity yet.</p>`;
  liveTradeFeedPanel.innerHTML = `<h3>Live Trade Feed</h3>${items}`;
}

export function renderOffersInbox() {
  if (!offersInboxPanel || !offersInboxList || !offerScopeTabs) return;
  offerScopeTabs.querySelectorAll("[data-offer-scope]").forEach((button) => {
    button.classList.toggle("active", button.dataset.offerScope === state.offersScope);
  });
  const items = state.offersInbox.length
    ? state.offersInbox
        .map((offer) => {
          const actorName = state.offersScope === "received" ? offer.senderName : offer.recipientName;
          const label = state.offersScope === "received" ? "From" : "To";
          const titles = (offer.selectedPosts || []).map((post) => post.title).join(", ");
          return `
            <div class="offer-card">
              <p><strong>${label}:</strong> ${actorName}</p>
              <p><strong>Items:</strong> ${titles || "No items listed"}</p>
              <span class="offer-meta">${offer.status} - ${formatRelativeTime(offer.createdAt)}</span>
            </div>
          `;
        })
        .join("")
    : `<p class="muted">No ${state.offersScope} offers yet.</p>`;
  offersInboxList.innerHTML = items;
}

export function renderProfileStats() {
  const trades = document.getElementById("profileTradesStat");
  const likes = document.getElementById("profileLikesStat");
  const offers = document.getElementById("profileOffersStat");
  if (trades) trades.textContent = String(state.profileStats?.trades ?? 0);
  if (likes) likes.textContent = String(state.profileStats?.likes ?? 0);
  if (offers) offers.textContent = String(state.profileStats?.offers ?? 0);
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

export function applyProfile() {
  if (!state.profile) return;
  document.getElementById("profileName").textContent = state.profile.name;
  document.getElementById("profileBio").textContent = state.profile.bio;
  document.getElementById("profileAvatar").textContent = state.profile.name.slice(0, 1).toUpperCase();
  document.getElementById("nameInput").value = state.profile.name;
  document.getElementById("bioInput").value = state.profile.bio;
  document.getElementById("tagsInput").value = state.profile.tags.join(", ");
  updateProfileTags(state.profile.tags);
}

export function setProfileEditState(enabled) {
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

export function applySession(session) {
  state.isAuthenticated = Boolean(session?.authenticated && session.user);
  setProfileEditState(state.isAuthenticated);

  const restrictedViews = ["online", "shop", "profile"];
  const currentView = Array.from(views).find((view) => view.classList.contains("active"))?.id;
  if (!state.isAuthenticated && restrictedViews.includes(currentView)) {
    showView("landing");
  }

  const topAuthBtn = document.getElementById("topAuthBtn");
  const topAvatar = document.getElementById("topAvatar");
  if (topAuthBtn) {
    topAuthBtn.textContent = state.isAuthenticated ? "Sign Out" : "Log In";
    topAuthBtn.href = state.isAuthenticated ? "/auth/logout" : "login.html";
    topAuthBtn.className = state.isAuthenticated ? "ghost" : "primary";
  }

  if (topAvatar) {
    if (state.isAuthenticated && session?.user) {
      topAvatar.textContent = (session.user.name || "U").slice(0, 1).toUpperCase();
      topAvatar.hidden = false;
      if (session.user.picture) {
        topAvatar.style.backgroundImage = `url("${session.user.picture}")`;
        topAvatar.classList.add("has-image");
        topAvatar.textContent = "";
      } else {
        topAvatar.style.backgroundImage = "";
        topAvatar.classList.remove("has-image");
      }
    } else {
      topAvatar.style.backgroundImage = "";
      topAvatar.classList.remove("has-image");
      topAvatar.textContent = "M";
      topAvatar.hidden = true;
    }
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

export function openModal(modal) {
  modal.setAttribute("aria-hidden", "false");
}

export function closeModal(modal) {
  modal.setAttribute("aria-hidden", "true");
}

export function openOfferModal(preselectIndex = null) {
  offerGrid.querySelectorAll(".offer-item").forEach((item) => item.classList.remove("selected"));
  openModal(document.getElementById("offerModal"));
  if (preselectIndex !== null) {
    requestAnimationFrame(() => {
      const target = offerGrid.querySelector(`[data-index="${preselectIndex}"]`);
      if (target) target.classList.add("selected");
    });
  }
}

export function renderBoardTags(boardPosts) {
  const tagWrap = document.getElementById("boardTags");
  const tags = new Set();
  boardPosts.forEach((post) => {
    post.items.forEach((item) => tags.add(item));
  });
  tagWrap.innerHTML = "";
  Array.from(tags).forEach((tag) => {
    const btn = document.createElement("button");
    btn.textContent = tag;
    if (state.boardFilter.tag === tag) btn.classList.add("active");
    btn.addEventListener("click", () => {
      state.boardFilter.tag = state.boardFilter.tag === tag ? "" : tag;
      renderBoardTags(state.currentBoardPosts);
      const boardId = Number(document.getElementById("boardDetailTitle").dataset.boardId);
      const board = state.boards.find((item) => item.id === boardId);
      if (board) renderBoardDetail(board, state.currentBoardPosts);
    });
    tagWrap.appendChild(btn);
  });
}

export function renderBoardDetail(board, boardPosts) {
  const title = document.getElementById("boardDetailTitle");
  title.textContent = board.name;
  title.dataset.boardId = board.id;
  document.getElementById("boardDetailDesc").textContent = board.description || "";
  const grid = document.getElementById("boardDetailGrid");
  const query = state.boardFilter.query.toLowerCase();
  const filtered = boardPosts.filter((post) => {
    const matchesTag = state.boardFilter.tag ? post.items.includes(state.boardFilter.tag) : true;
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
