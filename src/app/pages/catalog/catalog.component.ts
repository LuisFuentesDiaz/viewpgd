import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  AfterViewInit,
  ViewChild,
  ElementRef,
  OnDestroy,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { Movie } from '../../models/movie';
import { DbService } from '../../services/db.service';
import { UserDataService } from '../../services/user-data.service';

const PAGE_SIZE = 30;
const CAROUSEL_SIZE = 15;
const MAX_CAROUSEL_YEARS = 5;
type OrderBy = 'year' | 'name' | 'upload_date';
type Order = 'asc' | 'desc';

export interface YearCarousel {
  year: number;
  movies: Movie[];
}

@Component({
  selector: 'app-catalog',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './catalog.component.html',
  styleUrl: './catalog.component.css',
})
export class CatalogComponent implements OnInit, AfterViewInit, OnDestroy {
  private db = inject(DbService);
  private userData = inject(UserDataService);
  private router = inject(Router);

  @ViewChild('movieGrid') movieGridRef?: ElementRef<HTMLUListElement>;
  @ViewChild('loadMoreSentinel') sentinelRef?: ElementRef<HTMLElement>;

  readonly movies = signal<Movie[]>([]);
  readonly filterQuery = signal('');
  readonly orderBy = signal<OrderBy>('upload_date');
  readonly order = signal<Order>('desc');
  readonly favoritesOnly = signal(false);
  readonly viewMode = signal<'grid' | 'list'>('grid');
  readonly showFullCatalog = signal(false);
  readonly navVisible = signal(true);
  readonly recentMovies = signal<Movie[]>([]);
  readonly carousels = signal<YearCarousel[]>([]);
  readonly carouselsLoading = signal(true);
  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly hasMore = signal(true);
  readonly totalCount = signal<number | null>(null);
  readonly error = signal<string | null>(null);
  readonly linkPickerMovie = signal<Movie | null>(null);
  readonly linkPickerOptions = signal<string[]>([]);

  readonly favoritesSet = this.userData.favorites;

  readonly displayedMovies = computed(() => {
    const list = this.movies();
    if (this.favoritesOnly()) {
      return list.filter((m) => this.favoritesSet().has(m.id));
    }
    return list;
  });

  private filterDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private lastScrollY = 0;
  private readonly scrollThreshold = 80;

  ngOnInit(): void {
    if (!this.db.hasCustomDb()) {
      this.router.navigate(['/']);
      return;
    }
    this.loadCarousels();
  }

  private loadCarousels(): void {
    this.carouselsLoading.set(true);
    const loadRecent = this.db
      .getMoviesPage(0, CAROUSEL_SIZE, undefined, 'upload_date', 'desc')
      .catch(() => this.db.getMoviesPage(0, CAROUSEL_SIZE, undefined, 'year', 'desc'));
    const loadByYear = this.db.getYears().then((years) => {
      const limited = years.slice(0, MAX_CAROUSEL_YEARS);
      return Promise.all(
        limited.map((year) =>
          this.db.getMoviesPage(0, CAROUSEL_SIZE, undefined, 'year', 'desc', year).then((movies) => ({ year, movies }))
        )
      );
    });
    Promise.all([loadRecent, loadByYear])
      .then(([recentList, rows]) => {
        this.recentMovies.set(recentList);
        this.carousels.set(rows.filter((r) => r.movies.length > 0));
        this.carouselsLoading.set(false);
      })
      .catch(() => {
        this.recentMovies.set([]);
        this.carousels.set([]);
        this.carouselsLoading.set(false);
      });
  }

  showFullCatalogView(): void {
    this.showFullCatalog.set(true);
    this.navVisible.set(true);
    this.loadFirstPage();
  }

  showCarouselsView(): void {
    this.showFullCatalog.set(false);
  }

  private loadFirstPage(): void {
    this.loading.set(true);
    this.error.set(null);
    this.movies.set([]);
    this.hasMore.set(true);
    this.totalCount.set(null);
    const search = this.filterQuery().trim() || undefined;
    this.db
      .getMoviesPage(0, PAGE_SIZE, search, this.orderBy(), this.order())
      .then((list) => {
        this.movies.set(list);
        this.hasMore.set(list.length === PAGE_SIZE);
        this.db.getMoviesCount(search).then((n) => this.totalCount.set(n));
        this.loading.set(false);
        this.scheduleSentinelSetup();
      })
      .catch((err) => {
        this.error.set(err?.message ?? 'Error al cargar las películas');
        this.loading.set(false);
      });
  }

  private loadMore(): void {
    if (this.loadingMore() || !this.hasMore()) return;
    this.loadingMore.set(true);
    const offset = this.movies().length;
    const search = this.filterQuery().trim() || undefined;
    this.db
      .getMoviesPage(offset, PAGE_SIZE, search, this.orderBy(), this.order())
      .then((list) => {
        this.movies.update((prev) => [...prev, ...list]);
        this.hasMore.set(list.length === PAGE_SIZE);
        this.loadingMore.set(false);
      })
      .catch(() => this.loadingMore.set(false));
  }

  onFilterInput(value: string): void {
    this.filterQuery.set(value);
    if (this.filterDebounceTimer != null) clearTimeout(this.filterDebounceTimer);
    this.filterDebounceTimer = setTimeout(() => {
      this.filterDebounceTimer = null;
      if (this.showFullCatalog()) {
        this.loadFirstPage();
      } else {
        this.showFullCatalogView();
      }
    }, 400);
  }

  setOrder(by: OrderBy, dir: Order): void {
    this.orderBy.set(by);
    this.order.set(dir);
    this.loadFirstPage();
  }

  onOrderChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const [by, dir] = value.split('-') as [OrderBy, Order];
    if (by && dir) this.setOrder(by, dir);
  }

  toggleFavoritesOnly(): void {
    this.favoritesOnly.update((v) => !v);
  }

  toggleViewMode(): void {
    this.viewMode.update((v) => (v === 'grid' ? 'list' : 'grid'));
  }

  ngAfterViewInit(): void {}

  private scheduleSentinelSetup(): void {
    const trySetup = (attempt = 0) => {
      if (attempt > 5) return;
      this.setupSentinelObserver();
      if (!this.intersectionObserver && this.showFullCatalog() && !this.loading()) {
        setTimeout(() => trySetup(attempt + 1), 100);
      }
    };
    setTimeout(() => trySetup(0), 100);
  }

  private setupSentinelObserver(): void {
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
    const sentinel = this.sentinelRef?.nativeElement;
    if (!sentinel) return;
    // Usar viewport (root: null): más fiable que el scroll del ul con flex; dispara cuando el sentinela entra en pantalla
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && this.hasMore() && !this.loadingMore() && !this.loading()) {
          this.loadMore();
        }
      },
      { root: null, rootMargin: '300px 0px', threshold: 0 }
    );
    this.intersectionObserver.observe(sentinel);
  }

  ngOnDestroy(): void {
    if (this.filterDebounceTimer != null) clearTimeout(this.filterDebounceTimer);
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
  }

  readonly lastWatched = this.userData.lastWatchedMovie;

  goHome(): void {
    this.router.navigate(['/']);
  }

  continueWatching(): void {
    const last = this.userData.lastWatchedMovie();
    if (!last?.videoUrl) return;
    this.router.navigate(['/player'], {
      queryParams: { video: last.videoUrl, title: encodeURIComponent(last.title) },
    });
  }

  confirmRemoveDb(): void {
    if (window.confirm('¿Quitar la base de datos? Volverás a la pantalla de inicio.')) {
      this.db.useDefaultDb();
      this.userData.clearLastWatched();
      this.router.navigate(['/']);
    }
  }

  onPosterLoad(event: Event): void {
    (event.target as HTMLImageElement).classList.add('loaded');
  }

  playMovie(movie: Movie): void {
    this.db.getPreviewOptionsForMovie(movie.title, movie.year).then((options) => {
      if (options.length === 0) return;
      if (options.length === 1) {
        this.navigateToPlayer(movie, options[0]);
        return;
      }
      this.linkPickerMovie.set(movie);
      this.linkPickerOptions.set(options);
    });
  }

  navigateToPlayer(movie: Movie, previewUrl: string): void {
    this.closeLinkPicker();
    this.userData.setLastWatched({ ...movie, videoUrl: previewUrl });
    this.router.navigate(['/player'], {
      queryParams: { video: previewUrl, title: encodeURIComponent(movie.title) },
    });
  }

  closeLinkPicker(): void {
    this.linkPickerMovie.set(null);
    this.linkPickerOptions.set([]);
  }

  onListScroll(e: Event): void {
    const el = e.target as HTMLElement;
    const scrollTop = el.scrollTop;
    if (scrollTop <= this.scrollThreshold) {
      this.navVisible.set(true);
    } else if (scrollTop > this.lastScrollY) {
      this.navVisible.set(false);
    } else {
      this.navVisible.set(true);
    }
    this.lastScrollY = scrollTop;
  }

  toggleFavorite(event: Event, id: string): void {
    event.stopPropagation();
    this.userData.toggleFavorite(id);
  }

  isFavorite(id: string): boolean {
    return this.favoritesSet().has(id);
  }
}
