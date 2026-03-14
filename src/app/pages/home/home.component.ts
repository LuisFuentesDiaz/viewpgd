import { Component, inject, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { DbService } from '../../services/db.service';

@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
})
export class HomeComponent implements OnInit {
  private db = inject(DbService);
  private router = inject(Router);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.db.loadPersistedDb().then(() => {
      if (this.db.hasCustomDb()) {
        this.router.navigate(['/catalog']);
        return;
      }
      this.loading.set(false);
    }).catch(() => this.loading.set(false));
  }

  get hasDb(): boolean {
    return this.db.hasCustomDb();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.loading.set(true);
    this.error.set(null);
    this.db.loadCustomDb(file).then(() => {
      this.router.navigate(['/catalog']);
    }).catch((err) => {
      this.error.set(err?.message ?? 'Error al cargar el archivo');
      this.loading.set(false);
    });
    input.value = '';
  }
}
