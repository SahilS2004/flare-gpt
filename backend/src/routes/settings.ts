import { Hono } from "hono";
import { getUserSettings, updateUserSettings } from "../services/settings";

export const settingsRoute = (app: Hono) => {
  app.get("/settings", async (c: any) => {
    const payload = c.get("jwtPayload");
    if (!payload || !payload.id) {
      return c.json({ error: "Unauthorized access" }, 401);
    }

    const settings = await getUserSettings(c.env, payload.id);
    return c.json({
      status: "success",
      data: settings
    });
  });

  app.put("/settings", async (c: any) => {
    const payload = c.get("jwtPayload");
    if (!payload || !payload.id) {
      return c.json({ error: "Unauthorized access" }, 401);
    }

    const body = await c.req.json();
    const updates = {
      theme: body?.theme,
      microphoneEnabled: body?.microphoneEnabled,
      useRedis: body?.useRedis,
      useVector: body?.useVector,
      sidebarCollapsed: body?.sidebarCollapsed
    };

    const settings = await updateUserSettings(c.env, payload.id, updates);
    return c.json({
      status: "success",
      data: settings
    });
  });
};

