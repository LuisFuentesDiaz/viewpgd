import { Directive, ElementRef, Input, OnInit, OnChanges, SimpleChanges, OnDestroy, inject } from '@angular/core';

@Directive({
  selector: 'img[appLazySrc]',
  standalone: true,
})
export class LazyImgDirective implements OnInit, OnChanges, OnDestroy {
  @Input('appLazySrc') src = '';
  @Input() loadedClass = 'loaded';

  private el = inject(ElementRef<HTMLImageElement>);
  private observer: IntersectionObserver | null = null;
  private hasLoaded = false;

  ngOnInit(): void {
    this.observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          this.loadImage();
          this.observer?.disconnect();
          this.observer = null;
        }
      },
      { rootMargin: '200px 0px' }
    );
    this.observer.observe(this.el.nativeElement);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['src'] && !changes['src'].firstChange) {
      const img = this.el.nativeElement;
      img.classList.remove(this.loadedClass);
      this.hasLoaded = false;

      if (!this.observer) {
        // Ya estaba visible: cargar el nuevo src directamente
        this.loadImage();
      }
      // Si el observer sigue activo usará this.src actualizado al intersectar
    }
  }

  private loadImage(): void {
    const img = this.el.nativeElement;
    img.src = this.src;
    img.onload = () => {
      img.classList.add(this.loadedClass);
      this.hasLoaded = true;
    };
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}
