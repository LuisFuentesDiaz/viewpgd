import {
  Component,
  inject,
  signal,
  OnInit,
  AfterViewInit,
  ViewChild,
  ElementRef,
  OnDestroy,
} from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import type { Movie } from '../../models/movie';
import { DbService } from '../../services/db.service';

const PAGE_SIZE = 30;

@Component({
  selector: 'app-movie-list',
  standalone: true,
  templateUrl: './movie-list.component.html',
  styleUrl: './movie-list.component.css',
})
export class MovieListComponent implements OnInit, AfterViewInit, OnDestroy {
  private db = inject(DbService);
  private sanitizer = inject(DomSanitizer);

  @ViewChild('playerSection') playerSectionRef!: ElementRef<HTMLElement>;
  @ViewChild('movieGrid') movieGridRef?: ElementRef<HTMLUListElement>;
  @ViewChild('loadMoreSentinel') sentinelRef?: ElementRef<HTMLElement>;

  readonly movies = signal<Movie[]>([]);
  readonly filterQuery = signal('');
  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly hasMore = signal(true);
  readonly totalCount = signal<number | null>(null);
  readonly error = signal<string | null>(null);
  readonly currentVideoUrl = signal<SafeResourceUrl | null>(null);
  readonly listVisible = signal(false);
  readonly isFullscreen = signal(false);
  readonly hasCustomDb = signal(false);

  private fullscreenChangeHandler = (): void => {
    this.isFullscreen.set(!!document.fullscreenElement);
  };
  private filterDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private intersectionObserver: IntersectionObserver | null = null;

  ngOnInit(): void {
    document.addEventListener('fullscreenchange', this.fullscreenChangeHandler);
    this.db.loadPersistedDb().then((hadPersisted) => {
      this.hasCustomDb.set(this.db.hasCustomDb());
      if (this.db.hasCustomDb()) {
        this.loadFirstPage();
      } else {
        this.loading.set(false);
      }
    }).catch(() => {
      this.hasCustomDb.set(this.db.hasCustomDb());
      if (this.db.hasCustomDb()) {
        this.loadFirstPage();
      } else {
        this.loading.set(false);
      }
    });
  }

  private loadFirstPage(): void {
    this.loading.set(true);
    this.error.set(null);
    this.movies.set([]);
    this.hasMore.set(true);
    this.totalCount.set(null);
    const search = this.filterQuery().trim() || undefined;
    this.db.getMoviesPage(0, PAGE_SIZE, search).then((list) => {
      this.movies.set(list);
      this.hasMore.set(list.length === PAGE_SIZE);
      this.db.getMoviesCount(search).then((n) => this.totalCount.set(n));
      this.loading.set(false);
      setTimeout(() => this.setupSentinelObserver(), 0);
    }).catch((err) => {
      this.error.set(err?.message ?? 'Error al cargar las películas');
      this.loading.set(false);
    });
  }

  private loadMore(): void {
    if (this.loadingMore() || !this.hasMore()) return;
    this.loadingMore.set(true);
    const offset = this.movies().length;
    const search = this.filterQuery().trim() || undefined;
    this.db.getMoviesPage(offset, PAGE_SIZE, search).then((list) => {
      this.movies.update((prev) => [...prev, ...list]);
      this.hasMore.set(list.length === PAGE_SIZE);
      this.loadingMore.set(false);
    }).catch(() => {
      this.loadingMore.set(false);
    });
  }

  onFilterInput(value: string): void {
    this.filterQuery.set(value);
    if (this.filterDebounceTimer != null) clearTimeout(this.filterDebounceTimer);
    this.filterDebounceTimer = setTimeout(() => {
      this.filterDebounceTimer = null;
      if (this.hasCustomDb()) this.loadFirstPage();
    }, 400);
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.listVisible.set(true), 150);
  }

  private setupSentinelObserver(): void {
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
    const sentinel = this.sentinelRef?.nativeElement;
    const scrollRoot = this.movieGridRef?.nativeElement;
    if (!sentinel || !scrollRoot) return;
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && this.hasMore() && !this.loadingMore() && !this.loading()) {
          this.loadMore();
        }
      },
      { root: scrollRoot, rootMargin: '200px 0px', threshold: 0 }
    );
    this.intersectionObserver.observe(sentinel);
  }

  ngOnDestroy(): void {
    if (this.filterDebounceTimer != null) clearTimeout(this.filterDebounceTimer);
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
    document.removeEventListener('fullscreenchange', this.fullscreenChangeHandler);
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }

  toggleList(): void {
    this.listVisible.update((v) => !v);
  }

  async toggleFullscreen(): Promise<void> {
    const el = this.playerSectionRef?.nativeElement;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      // Navegador o política no permiten fullscreen
    }
  }

  onPosterLoad(event: Event): void {
    (event.target as HTMLImageElement).classList.add('loaded');
  }

  playHere(movie: Movie): void {
    this.currentVideoUrl.set(
      movie.videoUrl
        ? this.sanitizer.bypassSecurityTrustResourceUrl(movie.videoUrl)
        : null
    );
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.db.loadCustomDb(file).then(() => {
      this.hasCustomDb.set(true);
      this.loadFirstPage();
    }).catch((err) => {
      this.error.set(err?.message ?? 'Error al cargar el archivo');
    });
    input.value = '';
  }

  confirmRemoveDb(): void {
    if (window.confirm('¿Quitar la base de datos cargada? Volverás a la pantalla inicial.')) {
      this.useDefaultDb();
    }
  }

  useDefaultDb(): void {
    this.db.useDefaultDb();
    this.hasCustomDb.set(false);
    this.currentVideoUrl.set(null);
    this.filterQuery.set('');
    this.movies.set([]);
    this.loading.set(false);
    this.error.set(null);
  }
}
