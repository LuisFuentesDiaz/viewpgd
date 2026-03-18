import { Injectable, signal, computed } from '@angular/core';
import type { Movie } from '../models/movie';

const KEY_LAST_WATCHED = 'viewpgd-last-watched';
const KEY_FAVORITES = 'viewpgd-favorites';
const KEY_HISTORY = 'viewpgd-history';
const KEY_SEARCH_HISTORY = 'viewpgd-search-history';
const MAX_HISTORY = 30;
const MAX_SEARCH_HISTORY = 5;

export interface LastWatched {
  id: string;
  title: string;
  videoUrl: string;
  poster?: string;
  year: number;
}

export interface HistoryEntry extends LastWatched {
  watchedAt: number;
}

@Injectable({ providedIn: 'root' })
export class UserDataService {
  private lastWatched = signal<LastWatched | null>(this.loadLastWatched());
  private favoritesIds = signal<Set<string>>(this.loadFavorites());
  private historyList = signal<HistoryEntry[]>(this.loadHistory());
  private searchHistoryList = signal<string[]>(this.loadSearchHistory());

  readonly lastWatchedMovie = this.lastWatched.asReadonly();
  readonly favorites = computed(() => new Set(this.favoritesIds()));
  readonly history = this.historyList.asReadonly();
  readonly searchHistory = this.searchHistoryList.asReadonly();

  isFavorite(id: string): boolean {
    return this.favoritesIds().has(id);
  }

  setLastWatched(movie: Movie): void {
    const data: LastWatched = {
      id: movie.id,
      title: movie.title,
      videoUrl: movie.videoUrl,
      poster: movie.poster,
      year: movie.year,
    };
    this.lastWatched.set(data);
    this.addToHistory(data);
    try {
      localStorage.setItem(KEY_LAST_WATCHED, JSON.stringify(data));
    } catch {}
  }

  clearLastWatched(): void {
    this.lastWatched.set(null);
    try {
      localStorage.removeItem(KEY_LAST_WATCHED);
    } catch {}
  }

  clearHistory(): void {
    this.historyList.set([]);
    try {
      localStorage.removeItem(KEY_HISTORY);
    } catch {}
  }

  addSearchQuery(query: string): void {
    const q = query.trim();
    if (!q) return;
    const list = this.searchHistoryList().filter((v) => v.toLowerCase() !== q.toLowerCase());
    list.unshift(q);
    const trimmed = list.slice(0, MAX_SEARCH_HISTORY);
    this.searchHistoryList.set(trimmed);
    try {
      localStorage.setItem(KEY_SEARCH_HISTORY, JSON.stringify(trimmed));
    } catch {}
  }

  clearSearchHistory(): void {
    this.searchHistoryList.set([]);
    try {
      localStorage.removeItem(KEY_SEARCH_HISTORY);
    } catch {}
  }

  toggleFavorite(id: string): boolean {
    const set = new Set(this.favoritesIds());
    if (set.has(id)) {
      set.delete(id);
    } else {
      set.add(id);
    }
    this.favoritesIds.set(set);
    try {
      localStorage.setItem(KEY_FAVORITES, JSON.stringify([...set]));
    } catch {}
    return set.has(id);
  }

  private addToHistory(entry: LastWatched): void {
    const list = this.historyList().filter(
      (h) => h.title !== entry.title || h.year !== entry.year
    );
    list.unshift({ ...entry, watchedAt: Date.now() });
    const trimmed = list.slice(0, MAX_HISTORY);
    this.historyList.set(trimmed);
    try {
      localStorage.setItem(KEY_HISTORY, JSON.stringify(trimmed));
    } catch {}
  }

  private loadLastWatched(): LastWatched | null {
    try {
      const raw = localStorage.getItem(KEY_LAST_WATCHED);
      if (!raw) return null;
      return JSON.parse(raw) as LastWatched;
    } catch {
      return null;
    }
  }

  private loadFavorites(): Set<string> {
    try {
      const raw = localStorage.getItem(KEY_FAVORITES);
      if (!raw) return new Set();
      const arr = JSON.parse(raw) as string[];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  }

  private loadHistory(): HistoryEntry[] {
    try {
      const raw = localStorage.getItem(KEY_HISTORY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  private loadSearchHistory(): string[] {
    try {
      const raw = localStorage.getItem(KEY_SEARCH_HISTORY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.map((v) => String(v ?? '')).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
}
