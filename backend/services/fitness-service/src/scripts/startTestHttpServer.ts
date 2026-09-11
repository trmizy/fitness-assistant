import app from "../app";

const port = Number(process.env.PORT || 4302);
const server = app.listen(port, () => {
  console.log(`fitness-test-service:${port}`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
