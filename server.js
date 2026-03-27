const { initDb } = require("./db");
const { createApp } = require("./server/createApp");

const port = process.env.PORT || 8000;

initDb()
  .then((db) => {
    const app = createApp(db);
    app.listen(port, () => {
      console.log(`Trading Hub running on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database", err);
    process.exit(1);
  });
