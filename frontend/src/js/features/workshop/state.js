export const WORKSHOP_COLLECTION_FILE_TYPE = 2;

export const browserState = {
  page: 1,
  query: "",
  sort: "trend",
  tags: [],
  filetype: "0",
  loading: false,
  hasMore: true,
  loadFailed: false,
  data: [],
};

export function setWorkshopSearchQuery(value) {
  const hadQuery = Boolean(browserState.query);
  browserState.query = String(value ?? "").trim();
  if (browserState.query && !hadQuery) {
    browserState.sort = "relevance";
  } else if (!browserState.query && browserState.sort === "relevance") {
    browserState.sort = "trend";
  }
}

export function resetWorkshopPaging() {
  // A new query starts its own request sequence instead of waiting for an old page.
  browserState.loading = false;
  browserState.page = 1;
  browserState.data = [];
  browserState.hasMore = true;
  browserState.loadFailed = false;
}
