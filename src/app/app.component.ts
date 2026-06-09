import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

type Sender = 'bot' | 'user';
type IntentType = 'greeting' | 'help' | 'unknown' | 'weather';

interface Message {
  sender: Sender;
  text: string;
}

interface Intent {
  type: IntentType;
  original?: string;
  location?: string;
}

interface WeatherResponse {
  current: {
    temperature_2m: number;
    relative_humidity_2m: number;
    apparent_temperature: number;
    weather_code: number;
    wind_speed_10m: number;
  };
  current_units: {
    temperature_2m: string;
    apparent_temperature: string;
    wind_speed_10m: string;
  };
}

interface GeoResult {
  name: string;
  admin1?: string;
  country?: string;
  latitude: number;
  longitude: number;
}

interface GeoResponse {
  results?: GeoResult[];
}

interface LocationTarget {
  latitude: number;
  longitude: number;
  place: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  prompt = '';
  status = 'Ready';
  isBusy = false;
  messages: Message[] = [
    {
      sender: 'bot',
      text: 'Hi. Ask me for weather near you, or try something like "temperature in London".'
    }
  ];

  private readonly weatherCodes: Record<number, string> = {
    0: 'clear sky',
    1: 'mostly clear',
    2: 'partly cloudy',
    3: 'overcast',
    45: 'foggy',
    48: 'foggy with rime',
    51: 'light drizzle',
    53: 'drizzle',
    55: 'heavy drizzle',
    61: 'light rain',
    63: 'rain',
    65: 'heavy rain',
    71: 'light snow',
    73: 'snow',
    75: 'heavy snow',
    80: 'light showers',
    81: 'showers',
    82: 'heavy showers',
    95: 'thunderstorms',
    96: 'thunderstorms with hail',
    99: 'strong thunderstorms with hail'
  };

  async sendMessage(): Promise<void> {
    const text = this.prompt.trim();
    if (!text) return;

    this.prompt = '';
    this.addMessage('user', text);
    await this.answerPrompt(text);
  }

  private async answerPrompt(prompt: string): Promise<void> {
    const intent = this.understandPrompt(prompt);

    if (intent.type === 'greeting') {
      this.addMessage('bot', 'Hi. Ask me something like "weather right now" or "weather in London".');
      return;
    }

    if (intent.type === 'help') {
      this.addMessage('bot', 'I can answer current weather questions. Try "weather near me", "temperature in Mumbai", or "is it raining in Seattle?"');
      return;
    }

    if (intent.type !== 'weather') {
      this.addMessage('bot', 'I am a weather-only chatbot right now. Ask me about the current weather for your location or a city.');
      return;
    }

    this.setBusy(true);
    const botIndex = this.addMessage('bot', intent.location ? `Checking the weather in ${intent.location}...` : 'Checking the weather near you...');

    try {
      const target = intent.location ? await this.fetchCoordinates(intent.location) : await this.fetchCurrentLocation();
      const weather = await this.fetchWeather(target.latitude, target.longitude);
      const placeName = target.place || await this.fetchPlace(target.latitude, target.longitude);
      this.messages[botIndex].text = this.buildReply(weather, placeName, intent);
      this.status = 'Updated';
    } catch (error) {
      this.messages[botIndex].text = error instanceof Error ? error.message : 'Something went wrong. Try again.';
      this.status = 'Needs access';
    } finally {
      this.setBusy(false);
    }
  }

  private understandPrompt(prompt: string): Intent {
    const normalized = prompt.toLowerCase().trim();

    if (/^(hi|hello|hey|yo|good morning|good afternoon|good evening)\b/.test(normalized)) {
      return { type: 'greeting' };
    }

    if (/\b(help|what can you do|how does this work)\b/.test(normalized)) {
      return { type: 'help' };
    }

    const weatherWords = /\b(weather|temperature|temp|forecast|rain|raining|snow|snowing|sunny|cloudy|wind|windy|humidity|hot|cold|warm|chilly|degrees)\b/;
    if (!weatherWords.test(normalized)) {
      return { type: 'unknown' };
    }

    return {
      type: 'weather',
      original: prompt,
      location: this.extractLocation(prompt)
    };
  }

  private extractLocation(prompt: string): string {
    const cleaned = prompt
      .replace(/[?!.,]+$/g, '')
      .replace(/\b(right now|currently|today|please|pls|current|outside)\b/gi, '')
      .trim();

    const patterns = [
      /\b(?:in|at|for|near)\s+(.+)$/i,
      /\bweather\s+(.+)$/i,
      /\btemperature\s+(.+)$/i,
      /\btemp\s+(.+)$/i
    ];

    for (const pattern of patterns) {
      const match = cleaned.match(pattern);
      if (match?.[1]) {
        const location = match[1]
          .replace(/\b(me|my location|here|near me)\b/gi, '')
          .replace(/\b(weather|temperature|temp|forecast)\b/gi, '')
          .trim();
        return location || '';
      }
    }

    return '';
  }

  private fetchCurrentLocation(): Promise<LocationTarget> {
    if (!navigator.geolocation) {
      return Promise.reject(new Error('This browser does not support location, so I cannot check local weather yet.'));
    }

    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            place: ''
          });
        },
        () => reject(new Error('I need location permission to tell you the weather right now. Please allow location and try again.')),
        {
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 10 * 60 * 1000
        }
      );
    });
  }

  private async fetchCoordinates(location: string): Promise<LocationTarget> {
    const params = new URLSearchParams({
      name: location,
      count: '1',
      language: 'en',
      format: 'json'
    });

    const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
    if (!response.ok) {
      throw new Error('I could not search for that place. Try another city name.');
    }

    const data = await response.json() as GeoResponse;
    const result = data.results?.[0];
    if (!result) {
      throw new Error(`I could not find "${location}". Try a city name like "Paris" or "New York".`);
    }

    return {
      latitude: result.latitude,
      longitude: result.longitude,
      place: this.formatPlace(result)
    };
  }

  private async fetchWeather(latitude: number, longitude: number): Promise<WeatherResponse> {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
      temperature_unit: 'fahrenheit',
      wind_speed_unit: 'mph',
      timezone: 'auto'
    });

    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!response.ok) {
      throw new Error('The weather service did not answer. Try again in a minute.');
    }

    return response.json() as Promise<WeatherResponse>;
  }

  private async fetchPlace(latitude: number, longitude: number): Promise<string> {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      format: 'json',
      zoom: '10'
    });

    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`);
      if (!response.ok) return 'your area';
      const data = await response.json() as {
        address?: {
          city?: string;
          town?: string;
          village?: string;
          county?: string;
        };
      };
      return data.address?.city || data.address?.town || data.address?.village || data.address?.county || 'your area';
    } catch {
      return 'your area';
    }
  }

  private buildReply(data: WeatherResponse, place: string, intent: Intent): string {
    const current = data.current;
    const units = data.current_units;
    const description = this.weatherCodes[current.weather_code] || 'interesting weather';
    const temp = Math.round(current.temperature_2m);
    const feels = Math.round(current.apparent_temperature);
    const humidity = Math.round(current.relative_humidity_2m);
    const wind = Math.round(current.wind_speed_10m);
    const original = intent.original || '';

    if (/\b(rain|raining)\b/i.test(original)) {
      return `Right now in ${place}, it is ${description}. The temperature is ${temp}${units.temperature_2m}, and it feels like ${feels}${units.apparent_temperature}.`;
    }

    if (/\b(wind|windy)\b/i.test(original)) {
      return `Right now in ${place}, wind is around ${wind} ${units.wind_speed_10m}. It is ${temp}${units.temperature_2m} and ${description}.`;
    }

    if (/\b(humidity|humid)\b/i.test(original)) {
      return `Right now in ${place}, humidity is ${humidity}%. It is ${temp}${units.temperature_2m} and ${description}.`;
    }

    if (/\b(temp|temperature|hot|cold|warm|chilly|degrees)\b/i.test(original)) {
      return `Right now in ${place}, it is ${temp}${units.temperature_2m} and feels like ${feels}${units.apparent_temperature}. Conditions are ${description}.`;
    }

    return `Right now in ${place}, it is ${temp}${units.temperature_2m} and ${description}. It feels like ${feels}${units.apparent_temperature}, with ${humidity}% humidity and wind around ${wind} ${units.wind_speed_10m}.`;
  }

  private formatPlace(result: GeoResult): string {
    return [result.name, result.admin1, result.country]
      .filter(Boolean)
      .filter((part, index, parts) => parts.indexOf(part) === index)
      .join(', ');
  }

  private addMessage(sender: Sender, text: string): number {
    this.messages = [...this.messages, { sender, text }];
    window.setTimeout(() => {
      const messagePane = document.querySelector('.messages');
      if (messagePane) messagePane.scrollTop = messagePane.scrollHeight;
    });
    return this.messages.length - 1;
  }

  private setBusy(isBusy: boolean): void {
    this.isBusy = isBusy;
    if (isBusy) {
      this.status = 'Checking';
    }
  }
}
