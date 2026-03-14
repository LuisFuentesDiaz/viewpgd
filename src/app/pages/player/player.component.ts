import { Component, OnInit, signal, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-player',
  standalone: true,
  templateUrl: './player.component.html',
  styleUrl: './player.component.css',
})
export class PlayerComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private sanitizer = inject(DomSanitizer);

  videoUrl = signal<SafeResourceUrl | null>(null);
  title = signal<string>('Reproduciendo');

  ngOnInit(): void {
    this.route.queryParams.subscribe((params) => {
      const url = params['video'];
      const titleParam = params['title'];
      if (url) {
        this.videoUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
      }
      if (titleParam) {
        this.title.set(decodeURIComponent(titleParam));
      }
    });
  }
}
