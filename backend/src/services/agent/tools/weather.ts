import type { ToolDefinition } from "../types";

type Geo = { name: string; latitude: number; longitude: number };

const WEATHER_CODE_DESCRIPTIONS: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  61: "Light rain",
  63: "Moderate rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Moderate snow",
  75: "Heavy snow",
  80: "Rain showers",
  81: "Heavy rain showers",
  82: "Violent rain showers",
  95: "Thunderstorm",
  96: "Thunderstorm with light hail",
  99: "Thunderstorm with heavy hail"
};

async function geocodeLocation(location: string): Promise<Geo | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    location
  )}&count=1&language=en&format=json`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const json = (await response.json()) as any;
  const item = json?.results?.[0];
  if (!item) return null;
  return {
    name: `${item.name}${item.country ? `, ${item.country}` : ""}`,
    latitude: item.latitude,
    longitude: item.longitude
  };
}

export const weatherTool: ToolDefinition = {
  name: "weather",
  description:
    "Fetch current weather for a city or place using Open-Meteo. Use whenever the user asks about weather, temperature, or wind for a location.",
  parameters: {
    type: "object",
    properties: {
      location: {
        type: "string",
        description:
          "City and optional country, e.g. 'Bengaluru' or 'Paris, France'."
      }
    },
    required: ["location"]
  },
  handler: async (args) => {
    const location = String(args?.location ?? "").trim();
    if (!location) {
      throw new Error("Missing required 'location' argument.");
    }

    const geo = await geocodeLocation(location);
    if (!geo) {
      throw new Error(`Could not find weather location: ${location}`);
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&timezone=auto`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Weather provider is unavailable.");
    }
    const weather = (await response.json()) as any;
    const code: number | undefined = weather?.current?.weather_code;
    return {
      location: geo.name,
      temperatureC: weather?.current?.temperature_2m,
      humidity: weather?.current?.relative_humidity_2m,
      windKmh: weather?.current?.wind_speed_10m,
      weatherCode: code,
      description:
        typeof code === "number" ? WEATHER_CODE_DESCRIPTIONS[code] ?? null : null
    };
  }
};
