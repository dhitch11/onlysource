"use client";

/*
 * <Scrollable /> Owner: T8 DESIGN.
 *
 * OVERFLOW HONESTY. A container that scrolls sideways is hiding columns, and hidden columns
 * are hidden money data: /monopoly was concealing 663px including an AWARD PATH column cut
 * mid-badge, with nothing on screen saying more existed. This component makes the hidden
 * part visible as a fact: a right-edge fade plus a plain-words hint, rendered ONLY while
 * `scrollWidth > clientWidth` and there is still content to the right. A grid that fits
 * renders neither, so the affordance can never cry wolf.
 *
 * The measurement is live: scroll moves it, a resize or a content change (filter, sort,
 * expansion) re-measures through a ResizeObserver on both the scroller and its content.
 * Nothing here is decorative-only: the fade is pointer-transparent and aria-hidden, because
 * the information it encodes (there is more) is already reachable by scrolling, and the
 * hint states it in words for sighted users, which is the group scrolling affordances fail.
 */

import { useEffect, useRef, useState } from "react";
import styles from "./scrollable.module.css";

export function useScrollHint<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const overflowing = el.scrollWidth - el.clientWidth > 1;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      setMore(overflowing && !atEnd);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  return { ref, more };
}

/**
 * Wrap any horizontally-scrolling container. `className` is the page's own scroller class
 * (border, radius, overflow-x), applied to the inner element exactly as before, so pages
 * swap `<div className={styles.tableWrap}>` for `<Scrollable className={styles.tableWrap}>`
 * with no visual change beyond the affordance itself.
 */
export function Scrollable({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { ref, more } = useScrollHint<HTMLDivElement>();
  return (
    /*
     * THE HINT SITS BELOW THE SCROLLER, NOT ON TOP OF IT.
     *
     * It used to be `position: absolute` pinned to the frame's bottom-right, so it floated over
     * whatever happened to be at the bottom of the VISIBLE scroll area — the last row of a grid,
     * or the prose inside an expanded row. An affordance occluding the thing it exists to help
     * you reach. Padding the content cannot fix it: padding moves where the content ENDS and the
     * hint stays pinned to the frame, which another lane proved before handing it over.
     *
     * The same defect lived on the nav strip in AppShell, where the hint's opaque pill background
     * was hiding the collision rather than preventing it. Removing the pill for looking like a
     * "weird bubble" made two labels visibly occupy the same pixels. THE FIX IN BOTH PLACES IS
     * STRUCTURAL: stop floating over content and take a row.
     *
     * So the frame is a column. The scroll area keeps its own relative box, which is what the
     * fade anchors to — the fade legitimately overlays the last few characters, pointer-
     * transparent, the way torn paper reads, and it must not stretch over the hint row below.
     * The words then sit under the scroller, end-aligned, costing one short line only while
     * there is genuinely more to reach.
     */
    <div className={styles.frame}>
      <div className={styles.scrollArea}>
        <div ref={ref} className={className}>
          {children}
        </div>
        {more ? <div className={styles.fade} aria-hidden="true" /> : null}
      </div>
      {more ? (
        <span className={styles.hint} aria-hidden="true" data-scroll-hint>
          Scroll for more columns →
        </span>
      ) : null}
    </div>
  );
}
