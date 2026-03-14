import { Injectable, signal, computed } from '@angular/core';
import type { Movie } from '../models/movie';

const KEY_LAST_WATCHED = 'viewpgd-last-watched';
const KEY_FAVORITES = 'viewpgd-favorites';

export interface LastWatched {
  id: string;
  title: string;
  videoUrl: string;
  poster?: string;
  year: number;
}

@Injectable({ providedIn: 'root' })
export class UserDataService {
  private lastWatched = signal<LastWatched | null>(this.loadLastWatched());
  private favoritesIds = signal<Set<string>>(this.loadFavorites());

  readonly lastWatchedMovie = this.lastWatched.asReadonly();
  readonly favorites = computed(() => new Set(this.favoritesIds()));

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
}
