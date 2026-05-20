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

export function resetWorkshopPaging() {
  browserState.page = 1;
  browserState.data = [];
  browserState.hasMore = true;
  browserState.loadFailed = false;
}
