import { useRef, useState, ReactNode, PointerEvent } from "react";

/**
 * A timeline row that reveals a Delete action when swiped left.
 *
 * - Swipe (touch or mouse/trackpad drag) past a threshold snaps open to reveal
 *   the Delete button; a small swipe snaps back closed.
 * - Deleting asks for confirmation first, since removing a health record is
 *   destructive. The row animates out on confirm.
 * - A visible "Delete" affordance means the gesture is discoverable, not hidden.
 */
export default function SwipeCard({
  children,
  onDelete,
}: {
  children: ReactNode;
  onDelete: () => Promise<void> | void;
}) {
  const [offset, setOffset] = useState(0); // px transl  (0 closed, negative open)
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);

  const startX = useRef(0);
  const startOffset = useRef(0);
  const dragging = useRef(false);
  const moved = useRef(false);

  const ACTION_W = 88; // width of the revealed Delete action
  const THRESHOLD = 44;

  function onPointerDown(e: PointerEvent) {
    if (confirming) return;
    dragging.current = true;
    moved.current = false;
    startX.current = e.clientX;
    startOffset.current = offset;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging.current) return;
    const dx = e.clientX - startX.current;
    if (Math.abs(dx) > 4) moved.current = true;
    let next = startOffset.current + dx;
    next = Math.min(0, Math.max(-ACTION_W, next)); // clamp between closed and fully open
    setOffset(next);
  }

  function onPointerUp() {
    if (!dragging.current) return;
    dragging.current = false;
    const shouldOpen = offset < -THRESHOLD;
    setOpen(shouldOpen);
    setOffset(shouldOpen ? -ACTION_W : 0);
  }

  // Prevent the card's own click (expand) from firing right after a swipe.
  function onClickCapture(e: React.MouseEvent) {
    if (moved.current) {
      e.stopPropagation();
      e.preventDefault();
      moved.current = false;
    }
  }

  async function confirmDelete() {
    setRemoving(true);
    try {
      await onDelete();
    } catch {
      // Roll back the UI if the delete failed.
      setRemoving(false);
      setConfirming(false);
      setOpen(false);
      setOffset(0);
    }
  }

  return (
    <div className={`swipe ${removing ? "removing" : ""}`}>
      <div className="swipe-action" style={{ width: ACTION_W }}>
        {!confirming ? (
          <button
            className="swipe-del"
            onClick={() => setConfirming(true)}
            aria-label="Delete record"
          >
            Delete
          </button>
        ) : (
          <button className="swipe-del confirm" onClick={confirmDelete} aria-label="Confirm delete">
            {removing ? <span className="spinner light" /> : "Sure?"}
          </button>
        )}
      </div>

      <div
        className="swipe-body"
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>

      {/* Tapping the exposed area (when open) closes the row without deleting. */}
      {open && !confirming && (
        <button
          className="swipe-scrim"
          aria-label="Close"
          onClick={() => {
            setOpen(false);
            setOffset(0);
          }}
        />
      )}
    </div>
  );
}
