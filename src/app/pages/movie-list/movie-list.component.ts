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

  readonly movies = signal<Movie[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly currentVideoUrl = signal<SafeResourceUrl | null>(null);
  readonly listVisible = signal(false);
  readonly isFullscreen = signal(false);
  readonly hasCustomDb = signal(false);

  private fullscreenChangeHandler = (): void => {
    this.isFullscreen.set(!!document.fullscreenElement);
  };

  ngOnInit(): void {
    this.hasCustomDb.set(this.db.hasCustomDb());
    if (this.db.hasCustomDb()) {
      this.loadMovies();
    } else {
      this.loading.set(false);
    }
    document.addEventListener('fullscreenchange', this.fullscreenChangeHandler);
  }

  private loadMovies(): void {
    this.loading.set(true);
    this.error.set(null);
    this.db.getMovies().then((list) => {
      this.movies.set(list);
      this.loading.set(false);
    }).catch((err) => {
      this.error.set(err?.message ?? 'Error al cargar las películas');
      this.loading.set(false);
    });
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.listVisible.set(true), 150);
  }

  ngOnDestroy(): void {
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
      this.loadMovies();
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
    this.movies.set([]);
    this.loading.set(false);
    this.error.set(null);
  }
}
