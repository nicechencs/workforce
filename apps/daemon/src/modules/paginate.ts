import { AppError } from "./errors.js";
import type { PageDto } from "./dto.js";

export function paginate<T extends { id: string }>(
  items: T[],
  cursor: string | undefined,
  limit: number,
): PageDto<T> {
  let start = 0;
  if (cursor !== undefined) {
    const index = items.findIndex((item) => item.id === cursor);
    if (index === -1) {
      throw new AppError("validation_failed", "cursor is invalid");
    }
    start = index + 1;
  }
  const slice = items.slice(start, start + limit);
  const last = slice[slice.length - 1];
  const hasMore = start + slice.length < items.length;
  return {
    items: slice,
    page: {
      nextCursor: hasMore && last !== undefined ? last.id : null,
      hasMore,
    },
  };
}
