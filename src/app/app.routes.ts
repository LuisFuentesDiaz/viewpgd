import { Routes } from '@angular/router';
import { MovieListComponent } from './pages/movie-list/movie-list.component';
import { PlayerComponent } from './pages/player/player.component';

export const routes: Routes = [
  { path: '', component: MovieListComponent },
  { path: 'player', component: PlayerComponent },
];
