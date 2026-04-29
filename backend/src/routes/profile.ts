import { Hono } from "hono";

export const profileRoute = (app: Hono) => {
  app.get("/profile", (c) => {
    return c.json({
      status: "success",
      data: {
        id: "usr_123",
        name: "Test User",
        email: "test@example.com",
        createdAt: "2026-04-29T00:00:00Z"
      }
    });
  });
};
