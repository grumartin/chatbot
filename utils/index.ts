import { Message, OpenAIModel } from "@/types";
import { createParser, ParsedEvent, ReconnectInterval } from "eventsource-parser";

const city = 'Vienna';

const geoApiUrl = `https://api.openweathermap.org/geo/1.0/direct?q=${city}&appid=${process.env.OPEN_WEATHER_MAP_TOKEN}`;
const weatherApiUrl = `https://api.openweathermap.org/data/2.5/onecall`;

const getGeolocation = async () => {
  const response = await fetch(geoApiUrl, {
    method: "GET"
  });

  if (response.status !== 200) {
    throw new Error("OPEN WEATHER API returned an error");
  }

  const geolocationData = await response.json();
  const geolocation = geolocationData[0];
  const longitude = geolocation.lon;
  const latitude = geolocation.lat;

  return { longitude, latitude };
};

const getWeatherFromAPI = async (latitude: number, longitude: number) => {
  const apiUrl = `${weatherApiUrl}?lat=${latitude}&lon=${longitude}&exclude=minutely,daily&appid=${process.env.OPEN_WEATHER_MAP_TOKEN}`;

  const res = await fetch(apiUrl, {
    method: "GET"
  });

  if (res.status !== 200) {
    throw new Error("OPEN WEATHER API returned an error");
  }

  return await res.json();
};

export const OpenAIStream = async (messages: Message[]) => {
  const geolocation = await getGeolocation()
  const weatherData = await getWeatherFromAPI(geolocation.longitude, geolocation.latitude)
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    method: "POST",
    body: JSON.stringify({
      model: OpenAIModel.DAVINCI_TURBO,
      messages: [
        {
          role: "system",
          content: `You are a television weather presenter who can predict tomorrows weather
          and electricity consumption for a single-family house. Use the XGBoost algorithm for predicting the
          electricity consumption. For training just use some random generated data. Predict the consumption for the
          next 48h in kW/h. Also use this weather data: ${weatherData}. dt is a timestamp. `
        },
        ...messages
      ],
      max_tokens: 800,
      temperature: 0.0,
      stream: true
    })
  });

  if (res.status !== 200) {
    throw new Error("OpenAI API returned an error");
  }

  const stream = new ReadableStream({
    async start(controller) {
      const onParse = (event: ParsedEvent | ReconnectInterval) => {
        if (event.type === "event") {
          const data = event.data;

          if (data === "[DONE]") {
            controller.close();
            return;
          }

          try {
            const json = JSON.parse(data);
            const text = json.choices[0].delta.content;
            const queue = encoder.encode(text);
            controller.enqueue(queue);
          } catch (e) {
            controller.error(e);
          }
        }
      };

      const parser = createParser(onParse);

      for await (const chunk of res.body as any) {
        parser.feed(decoder.decode(chunk));
      }
    }
  });

  return stream;
};
