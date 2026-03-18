import {
  Component,
  inject,
  signal,
  computed,
  effect,
  OnInit,
  AfterViewInit,
  ViewChild,
  ElementRef,
  OnDestroy,
} from '@angular/core';
import { Router } from '@angular/router';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import type { Movie } from '../../models/movie';
import { DbService } from '../../services/db.service';
import { UserDataService, type HistoryEntry } from '../../services/user-data.service';
import { LazyImgDirective } from '../../directives/lazy-img.directive';

const PAGE_SIZE = 30;
const CAROUSEL_SIZE = 15;
const MAX_CAROUSEL_YEARS = 5;
type OrderBy = 'year' | 'name' | 'upload_date';
type Order = 'asc' | 'desc';
type Tab = 'home' | 'explore' | 'favorites' | 'history';

export interface YearCarousel {
  year: number;
  movies: Movie[];
}

@Component({
  selector: 'app-catalog',
  standalone: true,
  imports: [LazyImgDirective],
  templateUrl: './catalog.component.html',
  styleUrl: './catalog.component.css',
  host: {
    '(document:keydown)': 'onKeydown($event)',
  },
})
export class CatalogComponent implements OnInit, AfterViewInit, OnDestroy {
  private db = inject(DbService);
  readonly userData = inject(UserDataService);
  private router = inject(Router);
  private sanitizer = inject(DomSanitizer);

  @ViewChild('movieGrid') movieGridRef?: ElementRef<HTMLUListElement>;
  @ViewChild('loadMoreSentinel') sentinelRef?: ElementRef<HTMLElement>;
  @ViewChild('homeScroll') homeScrollRef?: ElementRef<HTMLElement>;
  @ViewChild('exploreScroll') exploreScrollRef?: ElementRef<HTMLElement>;
  @ViewChild('favoritesScroll') favoritesScrollRef?: ElementRef<HTMLElement>;
  @ViewChild('historyScroll') historyScrollRef?: ElementRef<HTMLElement>;

  readonly activeTab = signal<Tab>('home');
  readonly movies = signal<Movie[]>([]);
  readonly filterQuery = signal('');
  readonly orderBy = signal<OrderBy>('upload_date');
  readonly order = signal<Order>('desc');
  readonly favoritesOnly = signal(false);
  readonly recentMovies = signal<Movie[]>([]);
  readonly carousels = signal<YearCarousel[]>([]);
  readonly carouselsLoading = signal(true);
  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly hasMore = signal(true);
  readonly totalCount = signal<number | null>(null);
  readonly error = signal<string | null>(null);
  readonly showScrollTop = signal(false);
  readonly linkPickerMovie = signal<Movie | null>(null);
  readonly linkPickerOptions = signal<string[]>([]);
  readonly downloadPickerMovie = signal<Movie | null>(null);
  readonly downloadPickerOptions = signal<string[]>([]);
  readonly playerOverlaySrc = signal<SafeResourceUrl | null>(null);
  readonly playerOverlayTitle = signal<string>('');
  readonly playerMaximized = signal(false);
  readonly playerHeaderHidden = signal(false);
  readonly detailMovie = signal<Movie | null>(null);
  readonly searchOpen = signal(false);
  readonly searchDesktopFocused = signal(false);

  readonly favoritesSet = this.userData.favorites;
  readonly watchHistory = this.userData.history;
  readonly searchHistory = this.userData.searchHistory;

  readonly displayedMovies = computed(() => {
    const list = this.movies();
    if (this.favoritesOnly()) {
      return list.filter((m) => this.favoritesSet().has(m.id));
    }
    return list;
  });

  readonly favoriteMovies = computed(() => {
    return this.movies().filter((m) => this.favoritesSet().has(m.id));
  });

  readonly catalogStats = computed(() => {
    const count = this.totalCount();
    const carouselsData = this.carousels();
    const yearsSet = new Set<number>();
    for (const c of carouselsData) yearsSet.add(c.year);
    for (const m of this.recentMovies()) yearsSet.add(m.year);
    return {
      totalMovies: count ?? 0,
      totalYears: yearsSet.size,
      totalFavorites: this.favoritesSet().size,
      totalWatched: this.watchHistory().length,
    };
  });

  private filterDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressFired = false;

  constructor() {
    effect(() => {
      const open = this.playerOverlaySrc() != null;
      document.body.style.overflow = open ? 'hidden' : '';
      document.body.style.touchAction = open ? 'none' : '';
    });
  }

  ngOnInit(): void {
    if (!this.db.hasCustomDb()) {
      this.router.navigate(['/']);
      return;
    }
    this.loadCarousels();
    this.db.getMoviesCount().then((n) => this.totalCount.set(n)).catch(() => {});
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

  switchTab(tab: Tab): void {
    this.activeTab.set(tab);
    if (tab === 'explore' && this.movies().length === 0) {
      this.loadFirstPage();
    }
    if (tab === 'favorites' && this.movies().length === 0) {
      this.loadAllForFavorites();
    }
  }

  private loadAllForFavorites(): void {
    if (this.movies().length > 0) return;
    this.loading.set(true);
    this.db
      .getMoviesPage(0, 500, undefined, 'name', 'asc')
      .then((list) => {
        this.movies.set(list);
        this.loading.set(false);
      })
      .catch(() => this.loading.set(false));
  }

  showExploreView(): void {
    this.switchTab('explore');
  }

  private loadFirstPage(): void {
    this.loading.set(true);
    this.error.set(null);
    this.movies.set([]);
    this.hasMore.set(true);
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
    // Escribir en el input NO ejecuta la búsqueda. La búsqueda se confirma con Enter o con la lupa.
    this.filterQuery.set(value);
  }

  submitSearch(): void {
    this.searchOpen.set(false);
    this.searchDesktopFocused.set(false);
    this.runSearch(this.filterQuery());
  }

  clearSearch(): void {
    this.filterQuery.set('');
    this.searchOpen.set(false);
    this.searchDesktopFocused.set(false);
    this.runSearch('');
  }

  runSearch(query: string): void {
    const q = query.trim();
    this.filterQuery.set(q);
    if (q) this.userData.addSearchQuery(q);
    if (this.activeTab() !== 'explore') this.activeTab.set('explore');
    this.loadFirstPage();
  }

  applySearchSuggestion(query: string): void {
    this.searchOpen.set(false);
    this.searchDesktopFocused.set(false);
    this.runSearch(query);
  }

  onDesktopSearchFocus(): void {
    this.searchDesktopFocused.set(true);
  }

  onDesktopSearchBlur(): void {
    // Delay para permitir click en sugerencias antes de ocultarlas
    setTimeout(() => this.searchDesktopFocused.set(false), 120);
  }

  toggleSearch(): void {
    const open = !this.searchOpen();
    this.searchOpen.set(open);
    if (open) {
      setTimeout(() => {
        const input = document.querySelector<HTMLInputElement>('.search-bar__input');
        input?.focus();
      }, 50);
    }
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

  scrollCarousel(event: Event, direction: -1 | 1): void {
    const button = event.currentTarget as HTMLElement | null;
    const section = button?.closest('section');
    const container = section?.querySelector<HTMLElement>('.carousel');
    if (!container) return;
    const card = container.querySelector<HTMLElement>('.card');
    const step = card ? card.offsetWidth * 3 : container.clientWidth * 0.8;
    container.scrollBy({ left: step * direction, behavior: 'smooth' });
  }

  ngAfterViewInit(): void {}

  private scheduleSentinelSetup(): void {
    const trySetup = (attempt = 0) => {
      if (attempt > 5) return;
      this.setupSentinelObserver();
      if (!this.intersectionObserver && this.activeTab() === 'explore' && !this.loading()) {
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
    document.body.style.overflow = '';
    document.body.style.touchAction = '';
    if (this.filterDebounceTimer != null) clearTimeout(this.filterDebounceTimer);
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
  }

  readonly lastWatched = this.userData.lastWatchedMovie;

  continueWatching(): void {
    const last = this.userData.lastWatchedMovie();
    if (!last?.videoUrl) return;
    this.userData.setLastWatched({
      id: last.id, title: last.title, originalName: last.title, videoUrl: last.videoUrl,
      poster: last.poster, quality: '', year: last.year,
    });
    this.playerOverlaySrc.set(this.sanitizer.bypassSecurityTrustResourceUrl(last.videoUrl));
    this.playerOverlayTitle.set(last.title);
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
    this.db.getPreviewOptionsForMovie(movie.originalName, movie.year).then((options) => {
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
    this.playerOverlaySrc.set(this.sanitizer.bypassSecurityTrustResourceUrl(previewUrl));
    this.playerOverlayTitle.set(movie.title);
  }

  closePlayerOverlay(): void {
    this.playerOverlaySrc.set(null);
    this.playerOverlayTitle.set('');
    this.playerMaximized.set(false);
    this.playerHeaderHidden.set(false);
  }

  togglePlayerMaximized(): void {
    this.playerMaximized.update(v => !v);
    this.playerHeaderHidden.set(false);
  }

  onVideoWrapClick(): void {
    if (!this.playerMaximized()) return;
    this.playerHeaderHidden.update(v => !v);
  }

  closeLinkPicker(): void {
    this.linkPickerMovie.set(null);
    this.linkPickerOptions.set([]);
  }

  closeDownloadPicker(): void {
    this.downloadPickerMovie.set(null);
    this.downloadPickerOptions.set([]);
  }

  openDownloadPicker(movie: Movie): void {
    const urls = movie.downloadUrls ?? (movie.downloadUrl ? [movie.downloadUrl] : []);
    if (!urls.length) return;
    if (urls.length === 1) {
      window.open(urls[0]!, '_blank', 'noopener');
      return;
    }
    this.downloadPickerMovie.set(movie);
    this.downloadPickerOptions.set(urls);
  }

  private activeScrollRef(): ElementRef<HTMLElement> | undefined {
    switch (this.activeTab()) {
      case 'home':      return this.homeScrollRef;
      case 'explore':   return this.exploreScrollRef;
      case 'favorites': return this.favoritesScrollRef;
      case 'history':   return this.historyScrollRef;
    }
  }

  onTabScroll(event: Event): void {
    const el = event.target as HTMLElement;
    this.showScrollTop.set(el.scrollTop > 300);
  }

  scrollToTop(): void {
    this.activeScrollRef()?.nativeElement?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  toggleFavorite(event: Event, id: string): void {
    event.stopPropagation();
    this.userData.toggleFavorite(id);
  }

  isFavorite(id: string): boolean {
    return this.favoritesSet().has(id);
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (this.playerOverlaySrc()) { this.closePlayerOverlay(); return; }
      if (this.linkPickerMovie()) { this.closeLinkPicker(); return; }
      if (this.downloadPickerMovie()) { this.closeDownloadPicker(); return; }
      if (this.detailMovie()) { this.closeDetail(); return; }
      if (this.searchOpen()) { this.searchOpen.set(false); return; }
    }
    if (event.key === '/' && !this.isInputFocused()) {
      event.preventDefault();
      this.searchOpen.set(true);
      setTimeout(() => document.querySelector<HTMLInputElement>('.search-bar__input')?.focus(), 50);
    }
  }

  private isInputFocused(): boolean {
    const tag = document.activeElement?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  onCardPointerDown(event: Event, movie: Movie): void {
    this.longPressFired = false;
    this.longPressTimer = setTimeout(() => {
      this.longPressFired = true;
      this.showDetail(movie);
      if (navigator.vibrate) navigator.vibrate(30);
    }, 500);
  }

  onCardPointerUp(): void {
    if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = null; }
  }

  onCardClick(event: Event, movie: Movie): void {
    if (this.longPressFired) { event.preventDefault(); event.stopPropagation(); return; }
    // En móvil/táctil: mostrar siempre el diálogo de detalle
    if (navigator.maxTouchPoints > 0) {
      this.showDetail(movie);
    } else {
      this.playMovie(movie);
    }
  }

  showDetail(movie: Movie): void {
    // Mostrar rápido el detalle y luego enriquecer con todos los links de descarga (pueden venir en varias filas)
    this.detailMovie.set(movie);
    this.db.getDownloadOptionsForMovie(movie.originalName, movie.year).then((urls) => {
      if (!urls.length) return;
      const current = this.detailMovie();
      // Si el usuario ya cerró/cambió, no tocar.
      if (!current || current.id !== movie.id) return;
      this.detailMovie.set({
        ...current,
        downloadUrls: urls,
        downloadUrl: urls[0],
      });
    }).catch(() => {});
  }
  closeDetail(): void { this.detailMovie.set(null); }

  playFromDetail(): void {
    const movie = this.detailMovie();
    if (!movie) return;
    this.closeDetail();
    this.playMovie(movie);
  }

  toggleFavoriteFromDetail(): void {
    const movie = this.detailMovie();
    if (!movie) return;
    this.userData.toggleFavorite(movie.id);
  }

  playHistoryEntry(entry: HistoryEntry): void {
    this.userData.setLastWatched({
      id: entry.id, title: entry.title, originalName: entry.title, videoUrl: entry.videoUrl,
      poster: entry.poster, quality: '', year: entry.year,
    });
    this.playerOverlaySrc.set(this.sanitizer.bypassSecurityTrustResourceUrl(entry.videoUrl));
    this.playerOverlayTitle.set(entry.title);
  }

  timeAgo(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Justo ahora';
    if (mins < 60) return `Hace ${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Hace ${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `Hace ${days}d`;
    return `Hace ${Math.floor(days / 7)} sem`;
  }

  formatUploadDate(raw?: string): string {
    if (!raw) return '';
    // Formato: "YYYY-MM-DD HH:MM:SS" o "YYYY-MM-DD"
    const date = new Date(raw.replace(' ', 'T'));
    if (isNaN(date.getTime())) return raw;
    return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  formatFileSize(raw?: string): string {
    if (!raw) return '';
    const trimmed = raw.trim();

    // Ya tiene unidades con espacio: "1.5 GB", "500 MB"
    if (/\d\s+[KMGT]?B/i.test(trimmed)) return trimmed;

    // Tiene unidades pegadas: "1.5GB", "1.5G", "500MB", "500M"
    const unitMatch = trimmed.match(/^([\d.]+)\s*([KMGT]?B?)$/i);
    if (unitMatch) {
      const val = parseFloat(unitMatch[1]);
      const unit = unitMatch[2].toUpperCase();
      if (!isNaN(val)) {
        if (unit === 'GB' || unit === 'G') return `${val} GB`;
        if (unit === 'MB' || unit === 'M') return val >= 1000 ? `${(val / 1024).toFixed(1)} GB` : `${val} MB`;
        if (unit === 'KB' || unit === 'K') return val >= 1e6 ? `${(val / 1e6).toFixed(1)} GB` : val >= 1000 ? `${(val / 1024).toFixed(1)} MB` : `${val} KB`;
        if (unit === 'TB' || unit === 'T') return `${val} TB`;
      }
    }

    // Número puro — inferimos la unidad por magnitud
    const num = parseFloat(trimmed);
    if (isNaN(num)) return trimmed;
    if (num >= 1e9) return `${(num / 1e9).toFixed(2)} GB`;   // bytes
    if (num >= 1e6) return `${(num / 1e6).toFixed(1)} MB`;   // bytes
    if (num >= 1e3) return `${(num / 1e3).toFixed(0)} KB`;   // bytes
    // Número pequeño: asumir GB (ej. 1.5 almacenado como GB)
    if (num >= 0.01) return `${num} GB`;
    return trimmed;
  }
}
