export const state = {
  listings: [],
  posts: [],
  profile: null,
  boards: [],
  pendingSavePostId: null,
  currentBoardPosts: [],
  boardFilter: { query: "", tag: "" },
  isAuthenticated: false,
  matchPollTimer: null,
  feedPollTimer: null,
  liveTradeFeed: [],
  offersInbox: [],
  offersScope: "received",
  currentMatch: null,
  chatTimer: null,
};

export const api = {
  async request(path, options = {}) {
    const response = await fetch(path, options);
    if (!response.ok) {
      const message = await response.text();
      if (response.status === 401) {
        window.location.href = "login.html";
      }
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
