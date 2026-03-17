import { Directive, ElementRef, Input, OnInit, OnDestroy, inject } from '@angular/core';

@Directive({
  selector: 'img[appLazySrc]',
  standalone: true,
})
export class LazyImgDirective implements OnInit, OnDestroy {
  @Input('appLazySrc') src = '';
  @Input() loadedClass = 'loaded';

  private el = inject(ElementRef<HTMLImageElement>);
  private observer: IntersectionObserver | null = null;

  ngOnInit(): void {
    const img = this.el.nativeElement;

    this.observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          img.src = this.src;
          img.onload = () => img.classList.add(this.loadedClass);
          this.observer?.disconnect();
          this.observer = null;
        }
      },
      { rootMargin: '200px 0px' }
    );
    this.observer.observe(img);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}
