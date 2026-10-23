"use strict";

/* ============================================================
   定数
   ============================================================ */
const SUPABASE_URL = "https://dzfvxpykmqknfvsgmkgn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_HMcMM7G36QhFJKjWBFg5qw_YM9nXNWj";

const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { detectSessionInUrl: false, persistSession: true },
});

const GENRES = [
  "コミック",
  "青年コミック",
  "少年コミック",
  "少女コミック",
  "ワイドコミック",
  "文庫コミック",
  "ライトノベル",
  "文庫",
  "新書",
  "単行本",
  "コンピューター・IT",
  "その他",
  "CD",
  "DVD＆Blu-ray",
];

/* ============================================================
   キャッシュ（メモリ内データストア）
   ============================================================ */
let _cache = {
  books: [],
  users: [],
  loans: [],
  locations: [],
  requests: [],
  attributes: [],
  bookAttributes: [],
};

/* ============================================================
   Supabase 行マッピング
   ============================================================ */
const BOOK_STATES = {
  NORMAL: "normal",
  PROVISIONAL: "provisional",
  PURCHASE_PLANNED: "purchase_planned",
};

const BOOK_STATE_LABELS = {
  [BOOK_STATES.NORMAL]: "登録",
  [BOOK_STATES.PROVISIONAL]: "仮登録",
  [BOOK_STATES.PURCHASE_PLANNED]: "購入予定",
};

const BOOK_STATE_OPTIONS = [
  BOOK_STATES.NORMAL,
  BOOK_STATES.PROVISIONAL,
  BOOK_STATES.PURCHASE_PLANNED,
];

const BOOK_STATE_META_RE = /^\[\[BOOK_STATE:(normal|provisional|purchase_planned)\]\]\n?/;

function parseBookMemo(rawMemo) {
  const memo = rawMemo || "";
  const match = memo.match(BOOK_STATE_META_RE);
  return {
    state: match ? match[1] : null,
    memo: match ? memo.slice(match[0].length) : memo,
  };
}

function rowToBook(r) {
  const parsedMemo = parseBookMemo(r.memo || "");
  return {
    id: r.id,
    isbn: r.isbn || "",
    title: r.title || "",
    author: r.author || "",
    publisher: r.publisher || "",
    genre: r.genre || GENRES[0],
    stock: r.stock ?? 1,
    rental: r.rental || "○",
    memo: parsedMemo.memo,
    state: r.is_purchase_planned
      ? BOOK_STATES.PURCHASE_PLANNED
      : r.is_provisional
        ? BOOK_STATES.PROVISIONAL
        : parsedMemo.state || BOOK_STATES.NORMAL,
    mainAttributeId: r.main_attribute_id ? Number(r.main_attribute_id) : null,
    subAttributeIds: _cache.bookAttributes
      .filter((item) => Number(item.book_id) === Number(r.id))
      .map((item) => Number(item.attribute_id)),
    reservedStates: [
      Boolean(r.reserved_state_1),
      Boolean(r.reserved_state_2),
      Boolean(r.reserved_state_3),
    ],
    locationId: r.location_id || null,
  };
}

function bookToInsert(b) {
  const state = b.state || BOOK_STATES.NORMAL;
  const mainAttribute =
    _cache.attributes.find(
      (attribute) =>
        attribute.attribute_type === "main" && attribute.name === b.genre,
    ) || null;
  return {
    isbn: b.isbn || null,
    title: b.title || "",
    author: b.author || null,
    publisher: b.publisher || null,
    genre: b.genre || GENRES[0],
    stock: b.stock === 0 ? 0 : parseInt(b.stock) || 1,
    rental: b.rental || "○",
    memo: parseBookMemo(b.memo || "").memo.trim() || null,
    is_purchase_planned: state === BOOK_STATES.PURCHASE_PLANNED,
    is_provisional: state === BOOK_STATES.PROVISIONAL,
    reserved_state_1: Boolean(b.reservedStates?.[0]),
    reserved_state_2: Boolean(b.reservedStates?.[1]),
    reserved_state_3: Boolean(b.reservedStates?.[2]),
    main_attribute_id: b.mainAttributeId || mainAttribute?.id || null,
    location_id: b.locationId || null,
  };
}

function rowToUser(r) {
  return {
    id: r.id,
    name: r.name || "",
    kana: r.kana || "",
    contact: r.contact || "",
    memo: r.memo || "",
  };
}

function userToInsert(u) {
  return {
    name: u.name || "",
    kana: u.kana || null,
    contact: u.contact || null,
    memo: u.memo || null,
  };
}

function rowToLoan(r) {
  return {
    id: r.id,
    userId: r.user_id,
    bookId: r.book_id,
    loanDate: r.loan_date,
    dueDate: r.due_date || null,
    returnedAt: r.returned_at || null,
  };
}

function loanToInsert(l) {
  return {
    user_id: l.userId,
    book_id: l.bookId,
    loan_date: l.loanDate,
    due_date: l.dueDate || null,
    returned_at: null,
  };
}

function rowToLocation(r) {
  return {
    id: r.id,
    code: r.code || "",
    name: r.name || "",
    memo: r.memo || "",
    createdAt: r.created_at,
  };
}

function rowToRequest(r) {
  return {
    id: r.id,
    bookId: r.book_id,
    requesterName: r.requester_name || "",
    requesterContact: r.requester_contact || "",
    message: r.message || "",
    status: r.status || "pending",
    createdAt: r.created_at,
  };
}

/* ============================================================
   初期データ読み込み
   ============================================================ */
async function loadAllData() {
  const [booksRes, usersRes, loansRes, locsRes, reqsRes, attributesRes, bookAttributesRes] = await Promise.all([
    client.from("books").select("*"),
    client.from("users").select("*"),
    client.from("loans").select("*"),
    client.from("locations").select("*"),
    client.from("loan_requests").select("*"),
    client.from("attributes").select("*"),
    client.from("book_attributes").select("*"),
  ]);

  if (attributesRes.error) throw attributesRes.error;
  if (bookAttributesRes.error) throw bookAttributesRes.error;
  _cache.attributes = (attributesRes.data || []).sort((a, b) =>
    a.name.localeCompare(b.name, "ja"),
  );
  _cache.bookAttributes = bookAttributesRes.data || [];
  _cache.books = (booksRes.data || [])
    .map(rowToBook)
    .sort((a, b) => a.id - b.id);
  _cache.users = (usersRes.data || [])
    .map(rowToUser)
    .sort((a, b) => a.id - b.id);
  _cache.loans = (loansRes.data || [])
    .map(rowToLoan)
    .sort((a, b) => a.id - b.id);
  _cache.locations = (locsRes.data || [])
    .map(rowToLocation)
    .sort((a, b) => a.id - b.id);
  _cache.requests =
    !reqsRes.error && reqsRes.data
      ? reqsRes.data.map(rowToRequest).sort((a, b) => a.id - b.id)
      : [];
}

/* ============================================================
   Supabase Realtime
   ============================================================ */
function setupRealtime() {
  client
    .channel("db-changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "books" },
      async () => {
        const { data, error } = await client.from("books").select("*");
        if (!error) {
          _cache.books = (data || [])
            .map(rowToBook)
            .sort((a, b) => a.id - b.id);
          renderSearchTable();
          refreshLoanTab();
          renderStats();
        }
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "users" },
      async () => {
        const { data, error } = await client.from("users").select("*");
        if (!error) {
          _cache.users = (data || [])
            .map(rowToUser)
            .sort((a, b) => a.id - b.id);
          renderUserTable();
          refreshLoanTab();
          renderStats();
        }
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "loans" },
      async () => {
        const { data, error } = await client.from("loans").select("*");
        if (!error) {
          _cache.loans = (data || [])
            .map(rowToLoan)
            .sort((a, b) => a.id - b.id);
          refreshLoanTab();
          renderStats();
        }
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "locations" },
      async () => {
        const { data, error } = await client.from("locations").select("*");
        if (!error) {
          _cache.locations = (data || [])
            .map(rowToLocation)
            .sort((a, b) => a.id - b.id);
          renderLocationList();
          renderSearchTable();
        }
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "loan_requests" },
      async () => {
        const { data, error } = await client.from("loan_requests").select("*");
        if (!error) {
          _cache.requests = (data || [])
            .map(rowToRequest)
            .sort((a, b) => a.id - b.id);
          renderRequestList();
        }
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "attributes" },
      async () => {
        const { data, error } = await client.from("attributes").select("*");
        if (error) {
          showToast(`属性の再読み込みに失敗しました: ${error.message}`, "error");
          return;
        }
        _cache.attributes = (data || []).sort((a, b) =>
          a.name.localeCompare(b.name, "ja"),
        );
        refreshAttributeSelects();
        renderAttributeManagement();
        renderSearchTable();
        renderGenreCount();
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "book_attributes" },
      async () => {
        const { data, error } = await client
          .from("book_attributes")
          .select("*");
        if (error) {
          showToast(`副属性の再読み込みに失敗しました: ${error.message}`, "error");
          return;
        }
        _cache.bookAttributes = data || [];
        _cache.books = _cache.books.map((book) => ({
          ...book,
          subAttributeIds: _cache.bookAttributes
            .filter((item) => Number(item.book_id) === Number(book.id))
            .map((item) => item.attribute_id),
        }));
        renderSearchTable();
      },
    )
    .subscribe();
}

/* ============================================================
   同期ゲッター
   ============================================================ */
function getBooks() {
  return _cache.books;
}
function getUsers() {
  return _cache.users;
}
function getLoans() {
  return _cache.loans;
}
function getLocations() {
  return _cache.locations;
}
function getRequests() {
  return _cache.requests;
}

function hasActiveLoanForBook(bookId) {
  return _cache.loans.some(
    (loan) => loan.bookId === bookId && !loan.returnedAt,
  );
}

/* ============================================================
   ヘルパー
   ============================================================ */
function getLocationCode(locationId) {
  if (!locationId) return "";
  const loc = _cache.locations.find((l) => l.id === locationId);
  return loc ? loc.code : "";
}

function buildLocationOptions(selectedId, includeEmpty = true) {
  const empty = includeEmpty ? '<option value="">（位置なし）</option>' : "";
  return (
    empty +
    _cache.locations
      .map(
        (l) =>
          `<option value="${l.id}"${l.id == selectedId ? " selected" : ""}>${escHtml(l.code)}${l.name ? " – " + escHtml(l.name) : ""}</option>`,
      )
      .join("")
  );
}

function fillLocationSelect(selectEl, selectedId) {
  selectEl.innerHTML = buildLocationOptions(selectedId);
}

function buildGenreOptions(val) {
  const genres = getMainAttributes().map((attribute) => attribute.name);
  const selected =
    val || (genres.includes("コミック") ? "コミック" : genres[0]) || GENRES[0];
  if (selected && !genres.includes(selected)) genres.push(selected);
  return genres
    .map(
      (genre) =>
        `<option value="${escHtml(genre)}"${genre === selected ? " selected" : ""}>${escHtml(genre)}</option>`,
    )
    .join("");
}

function fillGenreSelect(selectEl, val) {
  if (!selectEl) return;
  selectEl.innerHTML = buildGenreOptions(val);
}

function getMainAttributes() {
  const mainAttributes = _cache.attributes.filter(
    (attribute) => attribute.attribute_type === "main",
  );
  return mainAttributes.length
    ? mainAttributes
    : GENRES.map((name) => ({ name }));
}

function getSubAttributes() {
  return _cache.attributes.filter(
    (attribute) => attribute.attribute_type === "sub",
  );
}

function getSubAttributesForMain(mainName) {
  const main = getMainAttributes().find(
    (attribute) => attribute.name === mainName,
  );
  if (!main?.id) return [];
  return getSubAttributes().filter(
    (attribute) =>
      Number(attribute.parent_attribute_id) === Number(main.id),
  );
}

function isSubAttributeAllowedForMain(attributeId, mainName) {
  return getSubAttributesForMain(mainName).some(
    (attribute) => Number(attribute.id) === Number(attributeId),
  );
}

function getPreferredSubAttribute(mainName) {
  const options = getSubAttributesForMain(mainName);
  const mainId = getMainAttributes().find(
    (attribute) => attribute.name === mainName,
  )?.id;
  return (
    options.find(
      (attribute) =>
        mainName === "コミック" && attribute.name === "青年コミック",
    ) ||
    options.find(
      (attribute) =>
        Number(attribute.parent_attribute_id) === Number(mainId),
    ) ||
    options[0]
  );
}

function buildSubAttributeOptions(selectedIds = [], mainName, defaultPreferred = false) {
  const options = mainName ? getSubAttributesForMain(mainName) : getSubAttributes();
  const requestedId = Number(selectedIds[0]);
  const selectedId = options.some(
    (attribute) => Number(attribute.id) === requestedId,
  )
    ? requestedId
    : 0;
  const preferred = defaultPreferred && !selectedId
    ? getPreferredSubAttribute(mainName)?.id
    : null;
  return '<option value="">選択なし</option>' + options
    .map(
      (attribute) =>
        `<option value="${attribute.id}"${(selectedId === Number(attribute.id) || preferred === Number(attribute.id)) ? " selected" : ""}>${escHtml(attribute.name)}${attribute.is_r18 ? "（R18）" : ""}</option>`,
    )
    .join("");
}

function fillSubAttributeSelect(selectEl, selectedIds = [], mainName, defaultPreferred = false) {
  if (!selectEl) return;
  selectEl.innerHTML = buildSubAttributeOptions(
    selectedIds,
    mainName,
    defaultPreferred,
  );
}

function refreshAttributeSelects() {
  [
    ["reg-genre", document.getElementById("reg-genre")?.value || "コミック"],
    ["edit-genre", document.getElementById("edit-genre")?.value],
    ["series-genre", document.getElementById("series-genre")?.value || "コミック"],
  ].forEach(([id, selected]) => {
    const select = document.getElementById(id);
    if (select) fillGenreSelect(select, selected);
  });

  const bulkGenre = document.getElementById("bulk-edit-genre");
  if (bulkGenre) {
    const selected = bulkGenre.value;
    bulkGenre.innerHTML =
      '<option value="">変更しない</option>' +
      getMainAttributes()
        .map(
          (attribute) =>
            `<option value="${escHtml(attribute.name)}">${escHtml(attribute.name)}</option>`,
        )
        .join("");
    bulkGenre.value = selected;
  }

  [
    ["reg-sub-attributes", "reg-genre", true],
    ["edit-sub-attributes", "edit-genre", true],
    ["series-sub-attributes", "series-genre", true],
    ["bulk-edit-sub-attributes", "bulk-edit-genre", false],
  ].forEach(([id, mainSelectId, defaultPreferred]) => {
    const select = document.getElementById(id);
    if (!select) return;
    const selected = select.value;
    const mainName = document.getElementById(mainSelectId)?.value;
    fillSubAttributeSelect(
      select,
      selected ? [selected] : [],
      mainName,
      defaultPreferred,
    );
  });

  const parentSelect = document.getElementById("attribute-parent");
  if (parentSelect) {
    const selected = parentSelect.value;
    parentSelect.innerHTML = buildMainAttributeOptions(selected);
  }
  const searchGenre = document.getElementById("search-genre");
  if (searchGenre) {
    const selected = getSelectedValues("search-genre");
    searchGenre.innerHTML = buildSearchGenreOptions(selected);
    syncSearchMultiSelect(searchGenre, true);
  }
  enhanceSearchMultiSelects();
  renderSearchTable();
}

function renderAttributeManagement() {
  const tbody = document.getElementById("attribute-tbody");
  if (!tbody) return;
  tbody.innerHTML = _cache.attributes.length
    ? _cache.attributes
        .map(
          (attribute) => {
            return `
            <tr>
              <td>${escHtml(attribute.name)}</td>
              <td>${attribute.attribute_type === "main" ? "主属性（ジャンル）" : "副属性"}</td>
              <td>${attribute.attribute_type === "main"
                ? "—"
                : `<select class="attribute-parent-select" data-attribute-id="${attribute.id}" aria-label="${escHtml(attribute.name)}の親属性">${buildMainAttributeOptions(attribute.parent_attribute_id, true)}</select><button class="btn btn-ghost btn-sm" type="button" data-save-attribute-parent="${attribute.id}">保存</button>`}</td>
              <td>${attribute.is_r18 ? "R18" : "—"}</td>
              <td><button class="btn btn-ghost btn-sm" type="button" data-delete-attribute="${attribute.id}">削除</button></td>
            </tr>`;
          },
        )
        .join("")
    : '<tr><td colspan="5" class="empty">属性がありません。</td></tr>';
}

function buildMainAttributeOptions(selectedId, includeBlank = false) {
  const blank = includeBlank ? '<option value="">未設定</option>' : "";
  return blank + getMainAttributes()
    .filter((attribute) => attribute.id)
    .map(
      (attribute) =>
        `<option value="${attribute.id}"${Number(selectedId) === Number(attribute.id) ? " selected" : ""}>${escHtml(attribute.name)}</option>`,
    )
    .join("");
}

function updateSubAttributeSelect(selectEl, mainName, selectedIds = [], defaultPreferred = false) {
  fillSubAttributeSelect(selectEl, selectedIds, mainName, defaultPreferred);
}

async function addAttribute() {
  const nameInput = document.getElementById("attribute-name");
  const typeSelect = document.getElementById("attribute-type");
  const isR18 = document.getElementById("attribute-r18").checked;
  const name = nameInput.value.trim();
  if (!name) {
    setResultMsg("attribute-result-msg", "属性名を入力してください。", "error");
    return;
  }

  const parentId = typeSelect.value === "sub"
    ? Number(document.getElementById("attribute-parent").value) || null
    : null;
  if (typeSelect.value === "sub" && !parentId) {
    setResultMsg("attribute-result-msg", "副属性の親となる主属性を選択してください。", "error");
    return;
  }

  const attribute = {
    name,
    attribute_type: typeSelect.value,
    is_r18: typeSelect.value === "sub" && isR18,
    parent_attribute_id: parentId,
  };
  const { data, error } = await client
    .from("attributes")
    .insert(attribute)
    .select()
    .single();
  if (error) {
    setResultMsg("attribute-result-msg", `属性を追加できませんでした: ${error.message}`, "error");
    return;
  }

  _cache.attributes.push(data);
  _cache.attributes.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  nameInput.value = "";
  document.getElementById("attribute-r18").checked = false;
  refreshAttributeSelects();
  renderAttributeManagement();
  renderGenreCount();
  setResultMsg("attribute-result-msg", `「${name}」を追加しました。`, "success");
}

async function deleteAttribute(attributeId) {
  const attribute = _cache.attributes.find((item) => item.id === attributeId);
  if (!attribute) return;
  if (
    attribute.attribute_type === "main" &&
    _cache.attributes.some(
      (item) => Number(item.parent_attribute_id) === Number(attributeId),
    )
  ) {
    setResultMsg(
      "attribute-result-msg",
      "子の副属性が登録されているため削除できません。先に副属性の親を変更するか、副属性を削除してください。",
      "error",
    );
    return;
  }
  if (!confirm(`属性「${attribute.name}」を削除しますか？`)) return;
  const { error } = await client.from("attributes").delete().eq("id", attributeId);
  if (error) {
    setResultMsg("attribute-result-msg", `属性を削除できませんでした: ${error.message}`, "error");
    return;
  }
  _cache.attributes = _cache.attributes
    .filter((item) => item.id !== attributeId)
    .map((item) =>
      Number(item.parent_attribute_id) === Number(attributeId)
        ? { ...item, parent_attribute_id: null }
        : item,
    );
  _cache.bookAttributes = _cache.bookAttributes.filter(
    (item) => Number(item.attribute_id) !== Number(attributeId),
  );
  _cache.books = _cache.books.map((book) => ({
    ...book,
    mainAttributeId:
      Number(book.mainAttributeId) === Number(attributeId)
        ? null
        : book.mainAttributeId,
    subAttributeIds: book.subAttributeIds.filter(
      (id) => Number(id) !== Number(attributeId),
    ),
  }));
  refreshAttributeSelects();
  renderAttributeManagement();
  renderSearchTable();
  renderGenreCount();
  setResultMsg("attribute-result-msg", `「${attribute.name}」を削除しました。`, "success");
}

function initAttributeTab() {
  document.getElementById("btn-attribute-add").addEventListener("click", addAttribute);
  document.getElementById("attribute-type").addEventListener("change", (event) => {
    const isSubAttribute = event.target.value === "sub";
    document.getElementById("attribute-parent-group").hidden = !isSubAttribute;
    document.getElementById("attribute-r18").disabled = event.target.value !== "sub";
    const defaultMainId = getMainAttributes().find(
      (attribute) => attribute.name === "コミック",
    )?.id;
    document.getElementById("attribute-parent").innerHTML =
      buildMainAttributeOptions(defaultMainId);
    if (event.target.value !== "sub") {
      document.getElementById("attribute-r18").checked = false;
    }
  });
  document.getElementById("attribute-tbody").addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-attribute]");
    if (button) deleteAttribute(Number(button.dataset.deleteAttribute));
    const saveParentButton = event.target.closest("[data-save-attribute-parent]");
    if (saveParentButton) {
      saveAttributeParent(Number(saveParentButton.dataset.saveAttributeParent));
    }
  });
}

async function saveAttributeParent(attributeId) {
  const select = document.querySelector(
    `.attribute-parent-select[data-attribute-id="${attributeId}"]`,
  );
  if (!select) return;
  const parentId = Number(select.value) || null;
  if (!parentId) {
    setResultMsg("attribute-result-msg", "副属性には親となる主属性が必要です。", "error");
    return;
  }
  const parent = _cache.attributes.find(
    (attribute) => Number(attribute.id) === parentId,
  );
  if (!parent || parent.attribute_type !== "main") {
    setResultMsg("attribute-result-msg", "親属性として主属性を選択してください。", "error");
    return;
  }
  const assignedBooks = getBooks().filter((book) =>
    (book.subAttributeIds || []).some(
      (id) => Number(id) === Number(attributeId),
    ),
  );
  if (assignedBooks.some((book) => book.genre !== parent.name)) {
    setResultMsg(
      "attribute-result-msg",
      "この副属性を使用中の書籍に別の主属性があるため、先に書籍の主属性をそろえてください。",
      "error",
    );
    return;
  }
  const { data, error } = await client
    .from("attributes")
    .update({ parent_attribute_id: parentId })
    .eq("id", attributeId)
    .select()
    .single();
  if (error) {
    setResultMsg("attribute-result-msg", `親属性を保存できませんでした: ${error.message}`, "error");
    return;
  }
  _cache.attributes = _cache.attributes.map((attribute) =>
    Number(attribute.id) === attributeId ? data : attribute,
  );
  refreshAttributeSelects();
  renderAttributeManagement();
  setResultMsg("attribute-result-msg", "親属性を保存しました。", "success");
}

function getBookState(book) {
  if (!book) return BOOK_STATES.NORMAL;
  if (book.state === BOOK_STATES.NORMAL) return BOOK_STATES.NORMAL;
  if (book.state === BOOK_STATES.PROVISIONAL) return BOOK_STATES.PROVISIONAL;
  if (book.state === BOOK_STATES.PURCHASE_PLANNED) return BOOK_STATES.PURCHASE_PLANNED;
  return BOOK_STATES.NORMAL;
}

function isProvisionalBook(book) {
  return getBookState(book) === BOOK_STATES.PROVISIONAL;
}

function isPurchasePlannedBook(book) {
  return getBookState(book) === BOOK_STATES.PURCHASE_PLANNED;
}

function getPendingBookLabel(book) {
  return isPurchasePlannedBook(book) ? "購入予定" : "仮登録";
}

function setResultMsg(elementId, message, type = "") {
  const element = document.getElementById(elementId);
  if (!element) return;
  element.textContent = message;
  element.className = `result-msg${type ? ` ${type}` : ""}`;
}

function showToast(message, type = "success") {
  const area = document.getElementById("toast-area");
  if (!area) return;
  const element = document.createElement("div");
  element.className = `toast toast-${type}`;
  element.textContent = message;
  area.appendChild(element);
  setTimeout(() => element.remove(), 3500);
}

function showTab(tabName) {
  const panel = document.getElementById(`tab-${tabName}`);
  if (!panel) return;

  if (tabName === "search") renderSearchTable();

  const activeBulk = document.getElementById("tab-bulk");
  if (activeBulk && activeBulk.classList.contains("active")) {
    syncBulkTableToData();
  }

  document.querySelectorAll(".tab-panel").forEach((item) => {
    item.classList.toggle("active", item === panel);
  });
  document.querySelectorAll(".tab-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });

  if (tabName === "bulk") renderBulkTable();
  if (tabName === "location") renderLocationList();
  if (tabName === "loan") refreshLoanTab();
  if (tabName === "stats") renderStats();
  if (tabName === "attributes") renderAttributeManagement();
}

function escHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function isOverdue(loan) {
  if (!loan.dueDate || loan.returnedAt) return false;
  return new Date(loan.dueDate) < new Date();
}

/**
 * 仮登録 / 購入予定の書籍が実際に届いたときに「本登録」する。
 * pending 状態の在庫が0だった場合は在庫を1に変更する（0より大きい在庫が
 * 入力されていればその値を優先する）。位置・貸出可否・その他の項目は、
 * 本登録時に入力された値を採用する。これにより pending 状態は解除され、
 * 通常の本と同じ扱いになる。
 */
async function upgradeProvisionalBook(existingBook, rowData) {
  const enteredStock = parseInt(rowData.stock);
  const newStock =
    existingBook.stock === 0
      ? enteredStock > 0
        ? enteredStock
        : 1
      : Number.isFinite(enteredStock) && enteredStock >= 0
        ? enteredStock
        : existingBook.stock;

  const changes = {
    title: rowData.title,
    author: rowData.author || null,
    publisher: rowData.publisher || null,
    genre: rowData.genre || GENRES[0],
    stock: newStock,
    rental: rowData.rental || "○",
    memo: rowData.memo || null,
    state: BOOK_STATES.NORMAL,
    mainAttributeId: rowData.mainAttributeId || null,
    subAttributeIds: rowData.subAttributeIds || [],
    location_id: rowData.locationId || null,
  };

  return await sbUpdateBook(existingBook.id, changes);
}

async function setPendingBookState(existingBook, rowData, state) {
  return await sbUpdateBook(existingBook.id, {
    title: rowData.title,
    author: rowData.author || null,
    publisher: rowData.publisher || null,
    genre: rowData.genre || GENRES[0],
    stock: 0,
    rental: "×",
    memo: rowData.memo || null,
    state,
    mainAttributeId: rowData.mainAttributeId || null,
    subAttributeIds: rowData.subAttributeIds || [],
    location_id: null,
  });
}

/* ============================================================
   書籍のSupabase書き込み操作
   ============================================================ */
async function sbAddBook(book) {
  const { data, error } = await client
    .from("books")
    .insert(bookToInsert(book))
    .select()
    .single();
  if (error) throw error;
  await syncBookSubAttributes(data.id, book.subAttributeIds || []);
  const newBook = rowToBook(data);
  _cache.books.push(newBook);
  return newBook;
}

async function sbBulkAddBooks(books) {
  const { data, error } = await client
    .from("books")
    .insert(books.map(bookToInsert))
    .select();
  if (error) throw error;
  for (const book of data || []) {
    const source = books.find((item) => item.isbn === book.isbn);
    await syncBookSubAttributes(book.id, source?.subAttributeIds || []);
  }
  const added = (data || []).map(rowToBook);
  _cache.books.push(...added);
  return added;
}

async function sbUpdateBook(id, changes) {
  const existing = _cache.books.find((book) => book.id === id);
  if (!existing) throw new Error("更新対象の書籍が見つかりません。");

  const nextBook = { ...existing, ...changes };
  if (Object.prototype.hasOwnProperty.call(changes, "genre")) {
    nextBook.mainAttributeId =
      _cache.attributes.find(
        (attribute) =>
          attribute.attribute_type === "main" &&
          attribute.name === changes.genre,
      )?.id || null;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "location_id")) {
    nextBook.locationId = changes.location_id || null;
  }

  const { error } = await client
    .from("books")
    .update(bookToInsert(nextBook))
    .eq("id", id);
  if (error) throw error;

  if (Object.prototype.hasOwnProperty.call(changes, "subAttributeIds")) {
    await syncBookSubAttributes(id, changes.subAttributeIds);
  }
  const updatedBook = { ...nextBook, id };
  delete updatedBook.location_id;
  _cache.books = _cache.books.map((book) =>
    book.id === id ? updatedBook : book,
  );
  return updatedBook;
}

async function syncBookSubAttributes(bookId, attributeIds) {
  const ids = [...new Set((attributeIds || []).map(Number).filter(Number.isFinite))];
  if (ids.length) {
    const { error } = await client.from("book_attributes").upsert(
      ids.map((attributeId) => ({
        book_id: bookId,
        attribute_id: attributeId,
      })),
      { onConflict: "book_id,attribute_id", ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  let deleteQuery = client.from("book_attributes").delete().eq("book_id", bookId);
  if (ids.length) {
    deleteQuery = deleteQuery.not("attribute_id", "in", `(${ids.join(",")})`);
  }
  const { error } = await deleteQuery;
  if (error) throw error;

  _cache.bookAttributes = _cache.bookAttributes
    .filter(
      (item) =>
        Number(item.book_id) !== Number(bookId) ||
        ids.includes(Number(item.attribute_id)),
    )
    .concat(
      ids
        .filter(
          (attributeId) =>
            !_cache.bookAttributes.some(
              (item) =>
                Number(item.book_id) === Number(bookId) &&
                Number(item.attribute_id) === attributeId,
            ),
        )
        .map((attributeId) => ({ book_id: bookId, attribute_id: attributeId })),
    );
}

async function sbBulkUpdateBookLocations(bookIds, locationId) {
  const { error } = await client
    .from("books")
    .update({ location_id: locationId })
    .in("id", bookIds);
  if (error) throw error;

  _cache.books = _cache.books.map((book) =>
    bookIds.includes(book.id) ? { ...book, locationId } : book,
  );
}

async function sbDeleteBook(id) {
  const { error: attributesError } = await client
    .from("book_attributes")
    .delete()
    .eq("book_id", id);
  if (attributesError) throw attributesError;
  const { error } = await client.from("books").delete().eq("id", id);
  if (error) throw error;
  _cache.bookAttributes = _cache.bookAttributes.filter(
    (item) => Number(item.book_id) !== Number(id),
  );
  _cache.books = _cache.books.filter((book) => book.id !== id);
}

async function sbAddUser(user) {
  const { data, error } = await client
    .from("users")
    .insert(userToInsert(user))
    .select()
    .single();
  if (error) throw error;
  const newUser = rowToUser(data);
  _cache.users.push(newUser);
  return newUser;
}

async function sbDeleteUser(id) {
  const { error } = await client.from("users").delete().eq("id", id);
  if (error) throw error;
  _cache.users = _cache.users.filter((u) => u.id !== id);
}

async function sbAddLoan(loan) {
  const { data, error } = await client
    .from("loans")
    .insert(loanToInsert(loan))
    .select()
    .single();
  if (error) throw error;
  const newLoan = rowToLoan(data);
  _cache.loans.push(newLoan);
  return newLoan;
}

async function sbReturnLoan(loanId) {
  const returnedAt = new Date().toISOString();
  const { error } = await client
    .from("loans")
    .update({ returned_at: returnedAt })
    .eq("id", loanId);
  if (error) throw error;
  const idx = _cache.loans.findIndex((l) => l.id === loanId);
  if (idx !== -1) _cache.loans[idx].returnedAt = returnedAt;
}

/* ============================================================
   書籍登録タブ
   ============================================================ */
async function fetchBookByIsbn(isbn) {
  const res = await fetch(
    `https://api.openbd.jp/v1/get?isbn=${encodeURIComponent(isbn)}`,
  );
  const data = await res.json();
  if (data && data[0]) {
    return {
      found: true,
      title: data[0].summary.title || "",
      author: data[0].summary.author || "",
      publisher: data[0].summary.publisher || "",
    };
  }
  return { found: false };
}

function initRegisterTab() {
  const genreSel = document.getElementById("reg-genre");
  fillGenreSelect(genreSel, "コミック");
  fillSubAttributeSelect(
    document.getElementById("reg-sub-attributes"),
    [],
    genreSel.value,
    true,
  );
  genreSel.addEventListener("change", () => {
    const subSelect = document.getElementById("reg-sub-attributes");
    updateSubAttributeSelect(subSelect, genreSel.value, [subSelect.value], true);
  });

  const stateSelect = document.getElementById("reg-state");
  const syncRegistrationState = () => {
    const pending = stateSelect.value !== BOOK_STATES.NORMAL;
    const stock = document.getElementById("reg-stock");
    const rental = document.getElementById("reg-rental");
    const location = document.getElementById("reg-location");
    stock.disabled = pending;
    rental.disabled = pending;
    if (pending) {
      stock.value = "0";
      rental.value = "×";
      location.value = "";
    } else {
      stock.value = stock.value === "0" ? "1" : stock.value;
      rental.value = rental.value === "×" ? "○" : rental.value;
    }
  };
  stateSelect.addEventListener("change", syncRegistrationState);

  const btnFetch = document.getElementById("btn-isbn-fetch");
  const isbnInput = document.getElementById("reg-isbn");
  const msgEl = document.getElementById("reg-isbn-msg");

  async function doIsbnFetch() {
    const isbn = isbnInput.value.trim();
    if (!isbn) {
      msgEl.textContent = "ISBNを入力してください。";
      msgEl.className = "isbn-msg error";
      return;
    }
    msgEl.textContent = "読み込み中...";
    msgEl.className = "isbn-msg loading";
    btnFetch.disabled = true;
    try {
      const book = await fetchBookByIsbn(isbn);
      if (book.found) {
        document.getElementById("reg-title").value = book.title;
        document.getElementById("reg-author").value = book.author;
        document.getElementById("reg-publisher").value = book.publisher;
        msgEl.textContent = "正常に読み込みが完了しました。";
        msgEl.className = "isbn-msg success";
      } else {
        document.getElementById("reg-title").value = "";
        document.getElementById("reg-author").value = "";
        document.getElementById("reg-publisher").value = "";
        msgEl.textContent =
          "データが見つかりませんでした。手動で入力してください。";
        msgEl.className = "isbn-msg error";
      }
    } catch {
      msgEl.textContent = "読み込みに失敗しました。手動で入力してください。";
      msgEl.className = "isbn-msg error";
    } finally {
      btnFetch.disabled = false;
    }
  }

  btnFetch.addEventListener("click", doIsbnFetch);
  isbnInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doIsbnFetch();
    }
  });

  document
    .getElementById("btn-reg-save")
    .addEventListener("click", async () => {
      const title = document.getElementById("reg-title").value.trim();
      if (!title) {
        setResultMsg("reg-result-msg", "タイトルは必須です。", "error");
        return;
      }
      const genre = document.getElementById("reg-genre").value;
      const subAttributeIds = getSelectedValues("reg-sub-attributes").map(Number);
      if (!genre || !subAttributeIds.length) {
        setResultMsg("reg-result-msg", "主属性と副属性は両方必須です。", "error");
        return;
      }
      if (!isSubAttributeAllowedForMain(subAttributeIds[0], genre)) {
        setResultMsg("reg-result-msg", "選択した副属性はこの主属性に属していません。", "error");
        return;
      }
      const isbn = isbnInput.value.trim();

      const existing = isbn ? getBooks().find((b) => b.isbn === isbn) : null;
      if (existing && !isProvisionalBook(existing) && !isPurchasePlannedBook(existing)) {
        setResultMsg(
          "reg-result-msg",
          "このISBNはすでに登録されています。",
          "error",
        );
        return;
      }
      const locationId =
        parseInt(document.getElementById("reg-location").value) || null;
      const state = stateSelect.value;
      const newBook = {
        isbn,
        title,
        author: document.getElementById("reg-author").value.trim(),
        publisher: document.getElementById("reg-publisher").value.trim(),
        genre,
        stock: state === BOOK_STATES.NORMAL
          ? parseInt(document.getElementById("reg-stock").value) || 1
          : 0,
        rental: state === BOOK_STATES.NORMAL
          ? document.getElementById("reg-rental").value
          : "×",
        memo: document.getElementById("reg-memo").value.trim(),
        locationId: state === BOOK_STATES.NORMAL ? locationId : null,
        state,
        mainAttributeId:
          _cache.attributes.find(
            (attribute) =>
              attribute.attribute_type === "main" &&
              attribute.name === genre,
          )?.id || null,
        subAttributeIds,
      };
      try {
        if (existing) {
          const fromLabel = getPendingBookLabel(existing);
          const upgraded =
            state === BOOK_STATES.NORMAL
              ? await upgradeProvisionalBook(existing, newBook)
              : await setPendingBookState(existing, newBook, state);
          if (state === BOOK_STATES.NORMAL) {
            setResultMsg(
              "reg-result-msg",
              `「${upgraded.title}」を本登録しました（${fromLabel}から更新・在庫${upgraded.stock}）。`,
              "success",
            );
            showToast(`${fromLabel}から本登録しました`);
          } else {
            const label = BOOK_STATE_LABELS[state];
            setResultMsg(
              "reg-result-msg",
              `「${upgraded.title}」を${label}に更新しました（在庫0・貸出不可）。`,
              "success",
            );
            showToast(`${label}に更新しました`);
          }
        } else {
          const saved = await sbAddBook(newBook);
          setResultMsg(
            "reg-result-msg",
            `「${saved.title}」を登録しました。`,
            "success",
          );
          showToast("書籍を登録しました");
        }
        clearRegForm();
      } catch (err) {
        setResultMsg("reg-result-msg", "登録に失敗しました。", "error");
        console.error(err);
      }
    });

  document
    .getElementById("btn-reg-clear")
    .addEventListener("click", clearRegForm);
}

function clearRegForm() {
  ["reg-isbn", "reg-title", "reg-author", "reg-publisher", "reg-memo"].forEach(
    (id) => {
      document.getElementById(id).value = "";
    },
  );
  document.getElementById("reg-stock").value = 1;
  document.getElementById("reg-rental").value = "○";
  document.getElementById("reg-stock").disabled = false;
  document.getElementById("reg-rental").disabled = false;
  document.getElementById("reg-state").value = BOOK_STATES.NORMAL;
  setSelectedValues(document.getElementById("reg-sub-attributes"), []);
  fillGenreSelect(document.getElementById("reg-genre"), GENRES[0]);
  const locSel = document.getElementById("reg-location");
  if (locSel) locSel.value = "";
  const msgEl = document.getElementById("reg-isbn-msg");
  msgEl.textContent = "";
  msgEl.className = "isbn-msg";
  setResultMsg("reg-result-msg", "", "");
}

/* ============================================================
   まとめて登録タブ
   ============================================================ */
let bulkRows = [];
let bulkValidationShown = false;
let bulkValidationMode = "register";

function scrollTableToBottom(elementId) {
  const container = document.getElementById(elementId);
  if (!container) return;
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

function getBulkRowValidation(row, rowIndex, mode = bulkValidationMode) {
  const errors = [];
  const pending = row.status === "fetching" ? "ISBN情報を取得中" : "";
  const isbn = (row.isbn || "").trim();
  const title = (row.title || "").trim();

  if (!pending) {
    if (!isbn) errors.push("ISBNなし");
    if (!title) errors.push("タイトルなし");
    if (!row.genre) errors.push("主属性なし");
    if (!row.subAttributeIds?.length) errors.push("副属性なし");
    else if (!isSubAttributeAllowedForMain(row.subAttributeIds[0], row.genre)) {
      errors.push("副属性の親属性不一致");
    }

    if (
      isbn &&
      bulkRows.some(
        (other, index) =>
          index !== rowIndex && (other.isbn || "").trim() === isbn,
      )
    ) {
      errors.push("ISBN重複（入力行）");
    }

    if (isbn) {
      const existing = getBooks().find((book) => book.isbn === isbn);
      const duplicateIsAllowed =
        (mode === "register" && existing && (isProvisionalBook(existing) || isPurchasePlannedBook(existing))) ||
        (mode === "provisional" && existing && isPurchasePlannedBook(existing));
      if (existing && !duplicateIsAllowed) {
        errors.push("ISBN重複（登録済み）");
      }
    }
  }

  return { errors, pending };
}

function getBulkValidationSummary() {
  return bulkRows.reduce(
    (summary, row, index) => {
      const result = getBulkRowValidation(row, index);
      if (result.errors.length || result.pending) summary.invalidRows++;
      return summary;
    },
    { invalidRows: 0 },
  );
}

function refreshBulkTableValidation() {
  const tbody = document.getElementById("bulk-tbody");
  if (!tbody || !bulkValidationShown) return;

  tbody.querySelectorAll("tr[data-idx]").forEach((tr) => {
    const index = parseInt(tr.dataset.idx, 10);
    const result = getBulkRowValidation(bulkRows[index], index);
    const hasError = result.errors.length > 0;
    const hasPending = Boolean(result.pending);
    const isbnHasError = result.errors.some((message) =>
      message.startsWith("ISBN"),
    );
    const titleHasError = result.errors.includes("タイトルなし");
    const mainAttributeHasError = result.errors.includes("主属性なし");
    const subAttributeHasError =
      result.errors.includes("副属性なし") ||
      result.errors.includes("副属性の親属性不一致");

    tr.classList.toggle("bulk-row-invalid", hasError);
    tr.classList.toggle("bulk-row-pending", hasPending);
    tr
      .querySelector(".bulk-isbn-val")
      ?.classList.toggle("input-error", isbnHasError);
    tr
      .querySelector(".bulk-title")
      ?.classList.toggle("input-error", titleHasError);
    tr
      .querySelector(".bulk-isbn-val")
      ?.setAttribute("aria-invalid", String(isbnHasError));
    tr
      .querySelector(".bulk-title")
      ?.setAttribute("aria-invalid", String(titleHasError));
    tr
      .querySelector(".bulk-genre")
      ?.classList.toggle("input-error", mainAttributeHasError);
    tr
      .querySelector(".bulk-genre")
      ?.setAttribute("aria-invalid", String(mainAttributeHasError));
    tr
      .querySelector(".bulk-sub-attributes")
      ?.classList.toggle("input-error", subAttributeHasError);
    tr
      .querySelector(".bulk-sub-attributes")
      ?.setAttribute("aria-invalid", String(subAttributeHasError));

    const errorEl = tr.querySelector(".bulk-row-errors");
    if (errorEl) {
      errorEl.textContent = [...result.errors, result.pending]
        .filter(Boolean)
        .join(" / ");
      errorEl.hidden = !hasError && !hasPending;
      errorEl.classList.toggle("pending", hasPending && !hasError);
    }
  });
}

function showBulkValidation(mode) {
  bulkValidationMode = mode;
  bulkValidationShown = true;
  syncBulkTableToData();
  renderBulkTable();
  return getBulkValidationSummary();
}

function initBulkTab() {
  const bulkIsbnInput = document.getElementById("bulk-isbn-input");
  const btnIsbnAdd = document.getElementById("btn-bulk-isbn-add");
  const bulkMsgEl = document.getElementById("bulk-isbn-msg");
  const bulkTbody = document.getElementById("bulk-tbody");

  const updateBulkValidationAfterInput = () => {
    syncBulkTableToData();
    refreshBulkTableValidation();
  };
  bulkTbody.addEventListener("input", updateBulkValidationAfterInput);
  bulkTbody.addEventListener("change", (event) => {
    if (!event.target.matches(".bulk-genre")) return;
    const row = event.target.closest("tr[data-idx]");
    const subSelect = row?.querySelector(".bulk-sub-attributes");
    if (subSelect) {
      updateSubAttributeSelect(
        subSelect,
        event.target.value,
        [subSelect.value],
        true,
      );
    }
  });
  bulkTbody.addEventListener("change", updateBulkValidationAfterInput);

  async function doBulkIsbnAdd() {
    const isbn = bulkIsbnInput.value.trim();
    if (!isbn) {
      bulkMsgEl.textContent = "ISBNを入力してください。";
      bulkMsgEl.className = "isbn-msg error";
      return;
    }
    bulkMsgEl.textContent = `「${isbn}」を取得中...`;
    bulkMsgEl.className = "isbn-msg loading";
    btnIsbnAdd.disabled = true;

    // 追加前に現在の入力値を保存（ISBNが消えるバグを修正）
    syncBulkTableToData();

    const rowData = {
      isbn,
      title: "",
      author: "",
      publisher: "",
      genre: GENRES[0],
      rental: "○",
      memo: "",
      locationId: null,
      subAttributeIds: [
        getPreferredSubAttribute("コミック")?.id,
      ].filter(Boolean),
      status: "fetching",
    };
    bulkRows.push(rowData);
    renderBulkTable();
    scrollTableToBottom("bulk-registration-table-wrap");

    try {
      const book = await fetchBookByIsbn(isbn);
      const idx =
        [...bulkRows]
          .map((r, i) => ({ r, i }))
          .reverse()
          .find((x) => x.r.isbn === isbn && x.r.status === "fetching")?.i ?? -1;
      if (idx !== -1) {
        if (book.found) {
          bulkRows[idx].title = book.title;
          bulkRows[idx].author = book.author;
          bulkRows[idx].publisher = book.publisher;
          bulkRows[idx].status = "done";
          bulkMsgEl.textContent = "正常に読み込みが完了しました。";
          bulkMsgEl.className = "isbn-msg success";
        } else {
          bulkRows[idx].status = "error";
          bulkMsgEl.textContent =
            "データが見つかりませんでした。手動で入力してください。";
          bulkMsgEl.className = "isbn-msg error";
        }
        renderBulkTable();
        scrollTableToBottom("bulk-registration-table-wrap");
      }
    } catch {
      const idx =
        [...bulkRows]
          .map((r, i) => ({ r, i }))
          .reverse()
          .find((x) => x.r.isbn === isbn && x.r.status === "fetching")?.i ?? -1;
      if (idx !== -1) {
        bulkRows[idx].status = "error";
        renderBulkTable();
        scrollTableToBottom("bulk-registration-table-wrap");
      }
      bulkMsgEl.textContent =
        "読み込みに失敗しました。手動で入力してください。";
      bulkMsgEl.className = "isbn-msg error";
    } finally {
      btnIsbnAdd.disabled = false;
      bulkIsbnInput.value = "";
      bulkIsbnInput.focus();
    }
  }

  btnIsbnAdd.addEventListener("click", doBulkIsbnAdd);
  bulkIsbnInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doBulkIsbnAdd();
    }
  });

  document.getElementById("btn-bulk-row-add").addEventListener("click", () => {
    // 追加前に現在の入力値を保存（ISBNが消えるバグを修正）
    syncBulkTableToData();
    bulkRows.push({
      isbn: "",
      title: "",
      author: "",
      publisher: "",
      genre: GENRES[0],
      rental: "○",
      memo: "",
      locationId: null,
      subAttributeIds: [
        getPreferredSubAttribute("コミック")?.id,
      ].filter(Boolean),
      status: "empty",
    });
    renderBulkTable();
    scrollTableToBottom("bulk-registration-table-wrap");
  });

  document
    .getElementById("btn-bulk-clear-all")
    .addEventListener("click", () => {
      if (
        bulkRows.length === 0 ||
        confirm("全行を削除してもよろしいですか？")
      ) {
        bulkRows = [];
        bulkValidationShown = false;
        renderBulkTable();
      }
    });

  async function saveBulkPendingBooks(state) {
    const isProvisionalMode = state === BOOK_STATES.PROVISIONAL;
    const validation = showBulkValidation(
      isProvisionalMode ? "provisional" : "purchase_planned",
    );
    if (!bulkRows.length) {
      setResultMsg("bulk-result-msg", "登録する行がありません。", "error");
      return;
    }
    if (validation.invalidRows) {
      setResultMsg(
        "bulk-result-msg",
        `${validation.invalidRows}行の入力内容を確認してください。`,
        "error",
      );
      return;
    }

    const label = isProvisionalMode ? "仮登録" : "購入予定";
    const validRows = bulkRows;
    const toAdd = [];
    const toConvert = [];
    let skipped = 0;

    validRows.forEach((r) => {
      const existing = r.isbn ? getBooks().find((b) => b.isbn === r.isbn) : null;
      if (!existing) {
        toAdd.push({
          ...r,
          stock: 0,
          rental: "×",
          locationId: null,
          state,
        });
        return;
      }

      if (isProvisionalMode && isPurchasePlannedBook(existing)) {
        toConvert.push({ row: r, existing });
        return;
      }

      skipped++;
    });

    if (!toAdd.length && !toConvert.length) {
      setResultMsg(
        "bulk-result-msg",
        `ISBN重複のためスキップ: ${skipped}件`,
        "error",
      );
      return;
    }

    try {
      let addedCount = 0;
      if (toAdd.length) {
        const added = await sbBulkAddBooks(toAdd);
        addedCount = added.length;
      }
      let convertedCount = 0;
      for (const { row, existing } of toConvert) {
        await setPendingBookState(existing, row, state);
        convertedCount++;
      }

      const msgParts = [];
      if (addedCount) msgParts.push(`${addedCount}件を${label}で登録しました`);
      if (convertedCount) msgParts.push(`${convertedCount}件を購入予定から仮登録へ変更しました`);
      let msg = msgParts.join("／") + "。";
      if (skipped > 0) msg += `（ISBN重複のためスキップ: ${skipped}件）`;
      setResultMsg("bulk-result-msg", msg, "success");
      showToast(msg);
      bulkRows = [];
      bulkValidationShown = false;
      renderBulkTable();
    } catch (err) {
      setResultMsg("bulk-result-msg", `${label}への登録に失敗しました。`, "error");
      console.error(err);
    }
  }

  // 「仮登録（配達待ち・在庫0）」ボタン：検索機能ではない。
  // まだ届いていない本を、在庫0・位置なし・貸出不可の仮登録状態で
  // 先に登録しておく。統計には表示されず、本が届いたら
  // 「まとめて登録する」を同じISBNで実行することで本登録される。
  document
    .getElementById("btn-bulk-provisional-save")
    .addEventListener("click", async () => {
      await saveBulkPendingBooks(BOOK_STATES.PROVISIONAL);
    });

  document
    .getElementById("btn-bulk-purchase-save")
    .addEventListener("click", async () => {
      await saveBulkPendingBooks(BOOK_STATES.PURCHASE_PLANNED);
    });

  document
    .getElementById("btn-bulk-save")
    .addEventListener("click", async () => {
      const validation = showBulkValidation("register");
      if (!bulkRows.length) {
        setResultMsg("bulk-result-msg", "登録する行がありません。", "error");
        return;
      }
      if (validation.invalidRows) {
        setResultMsg(
          "bulk-result-msg",
          `${validation.invalidRows}行の入力内容を確認してください。`,
          "error",
        );
        return;
      }
      const validRows = bulkRows;

      // ISBNが仮登録（配達待ち・在庫0）の本と一致する行は「本登録」として
      // 既存レコードを更新し、それ以外の重複は従来どおりスキップする。
      const toInsert = [];
      const toUpgrade = [];
      let skipped = 0;
      validRows.forEach((r) => {
        const existing = r.isbn
          ? getBooks().find((b) => b.isbn === r.isbn)
          : null;
        if (existing) {
          if (isProvisionalBook(existing) || isPurchasePlannedBook(existing)) {
            toUpgrade.push({ row: r, existing });
          } else {
            skipped++;
          }
        } else {
          toInsert.push(r);
        }
      });

      if (!toInsert.length && !toUpgrade.length) {
        setResultMsg(
          "bulk-result-msg",
          `ISBN重複のためスキップ: ${skipped}件`,
          "error",
        );
        return;
      }

      try {
        let addedCount = 0;
        if (toInsert.length) {
          const added = await sbBulkAddBooks(toInsert);
          addedCount = added.length;
        }
        let upgradedCount = 0;
        let provisionalUpgradeCount = 0;
        let purchaseUpgradeCount = 0;
        for (const { row, existing } of toUpgrade) {
          if (isPurchasePlannedBook(existing)) purchaseUpgradeCount++;
          else provisionalUpgradeCount++;
          await upgradeProvisionalBook(existing, row);
          upgradedCount++;
        }

        const msgParts = [];
        if (addedCount) msgParts.push(`${addedCount}件を登録しました`);
        if (provisionalUpgradeCount)
          msgParts.push(`${provisionalUpgradeCount}件を仮登録から本登録しました`);
        if (purchaseUpgradeCount)
          msgParts.push(`${purchaseUpgradeCount}件を購入予定から本登録しました`);
        let msg = msgParts.length
          ? msgParts.join("／") + "。"
          : "登録対象がありませんでした。";
        if (skipped > 0) msg += `（ISBN重複のためスキップ: ${skipped}件）`;
        setResultMsg("bulk-result-msg", msg, "success");
        showToast(msg);
        bulkRows = [];
        bulkValidationShown = false;
        renderBulkTable();
      } catch (err) {
        setResultMsg("bulk-result-msg", "登録に失敗しました。", "error");
        console.error(err);
      }
    });

  // 同一設定パネル
  const seriesGenreSel = document.getElementById("series-genre");
  fillGenreSelect(seriesGenreSel, "コミック");
  fillSubAttributeSelect(
    document.getElementById("series-sub-attributes"),
    [],
    seriesGenreSel.value,
    true,
  );
  seriesGenreSel.addEventListener("change", () => {
    const select = document.getElementById("series-sub-attributes");
    updateSubAttributeSelect(select, seriesGenreSel.value, [select.value], true);
  });
  document.getElementById("series-author").value = "";
  document.getElementById("series-publisher").value = "";

  document.getElementById("btn-bulk-series").addEventListener("click", () => {
    if (bulkRows.length === 0) {
      alert("対象となる行がありません。先に行を追加してください。");
      return;
    }
    fillGenreSelect(seriesGenreSel, "コミック");
    fillSubAttributeSelect(
      document.getElementById("series-sub-attributes"),
      [],
      seriesGenreSel.value,
      true,
    );
    document.getElementById("series-author").value = "";
    document.getElementById("series-publisher").value = "";
    document.getElementById("series-rental").value = "";
    document.querySelector(
      'input[name="series-status"][value="未完"]',
    ).checked = true;
    document.getElementById("series-volume").value = "";
    document.getElementById("series-panel").hidden = false;
  });

  document.getElementById("btn-series-close").addEventListener("click", () => {
    document.getElementById("series-panel").hidden = true;
  });

  document
    .getElementById("btn-series-apply")
    .addEventListener("click", () => applySeriesSettings(null));
  document
    .getElementById("btn-series-apply-provisional")
    .addEventListener("click", () => applySeriesSettings("provisional"));
  document
    .getElementById("btn-series-apply-purchase")
    .addEventListener("click", () => applySeriesSettings("purchase_planned"));
  document
    .getElementById("btn-series-apply-save")
    .addEventListener("click", () => applySeriesSettings("register"));
}

function applySeriesSettings(saveMode) {
  syncBulkTableToData();
  if (!bulkRows.length) {
    alert("対象となる行がありません。");
    return;
  }
  const genre = document.getElementById("series-genre").value;
  const rental = document.getElementById("series-rental").value;
  const status =
    document.querySelector('input[name="series-status"]:checked')?.value ||
    "未完";
  const vol = parseInt(document.getElementById("series-volume").value);
  const author = document.getElementById("series-author").value.trim();
  const publisher = document.getElementById("series-publisher").value.trim();
  const subAttributeIds = getSelectedValues("series-sub-attributes").map(Number);

  bulkRows.forEach((r) => {
    if (genre) r.genre = genre;
    if (rental) r.rental = rental;
    if (author) r.author = author;
    if (publisher) r.publisher = publisher;
    if (subAttributeIds.length) r.subAttributeIds = subAttributeIds;
    if (status === "完結" && vol > 0) r.memo = `完結${vol}巻`;
  });
  renderBulkTable();
  document.getElementById("series-panel").hidden = true;
  if (saveMode === "register") document.getElementById("btn-bulk-save").click();
  if (saveMode === "provisional") document.getElementById("btn-bulk-provisional-save").click();
  if (saveMode === "purchase_planned") document.getElementById("btn-bulk-purchase-save").click();
}

function syncBulkTableToData() {
  const tbody = document.getElementById("bulk-tbody");
  if (!tbody) return;
  const rows = tbody.querySelectorAll("tr[data-idx]");
  rows.forEach((tr) => {
    const idx = parseInt(tr.dataset.idx);
    if (!bulkRows[idx]) return;
    bulkRows[idx].isbn = tr.querySelector(".bulk-isbn-val").value;
    bulkRows[idx].title = tr.querySelector(".bulk-title").value.trim();
    bulkRows[idx].author = tr.querySelector(".bulk-author").value.trim();
    bulkRows[idx].publisher = tr.querySelector(".bulk-pub").value.trim();
    bulkRows[idx].genre = tr.querySelector(".bulk-genre").value;
    const subAttributeId = Number(tr.querySelector(".bulk-sub-attributes").value);
    bulkRows[idx].subAttributeIds = subAttributeId ? [subAttributeId] : [];
    bulkRows[idx].rental = tr.querySelector(".bulk-rental").value;
    const locEl = tr.querySelector(".bulk-location");
    if (locEl) bulkRows[idx].locationId = parseInt(locEl.value) || null;
  });
}

function renderBulkTable() {
  const tbody = document.getElementById("bulk-tbody");
  if (!bulkRows.length) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:1.5rem;">
      ISBNを取得するか、空行を追加して書籍情報を入力してください。
    </td></tr>`;
    return;
  }

  tbody.innerHTML = bulkRows
    .map((r, i) => {
      const validation = bulkValidationShown
        ? getBulkRowValidation(r, i)
        : { errors: [], pending: "" };
      const hasError = validation.errors.length > 0;
      const hasPending = Boolean(validation.pending);
      const isbnHasError = validation.errors.some((message) =>
        message.startsWith("ISBN"),
      );
      const titleHasError = validation.errors.includes("タイトルなし");
      const mainAttributeHasError = validation.errors.includes("主属性なし");
      const subAttributeHasError =
        validation.errors.includes("副属性なし") ||
        validation.errors.includes("副属性の親属性不一致");
      const cls =
        r.status === "fetching"
          ? "fetching"
          : r.status === "done"
            ? "fetch-done"
            : r.status === "error"
              ? "fetch-error"
              : "";
      const rowClasses = [
        cls,
        hasError ? "bulk-row-invalid" : "",
        hasPending ? "bulk-row-pending" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const rowErrors = [...validation.errors, validation.pending]
        .filter(Boolean)
        .join(" / ");
      const locOpts =
        '<option value="">—</option>' +
        _cache.locations
          .map(
            (l) =>
              `<option value="${l.id}"${l.id == r.locationId ? " selected" : ""}>${escHtml(l.code)}</option>`,
          )
          .join("");
      return `<tr data-idx="${i}" class="${rowClasses}">
      <td class="c-no mono" style="text-align:center;">${i + 1}</td>
      <td class="c-isbn" data-label="ISBN"><input class="bulk-isbn-val${isbnHasError ? " input-error" : ""}" type="text" value="${escHtml(r.isbn)}" placeholder="ISBN" aria-invalid="${isbnHasError}" /></td>
      <td class="c-title" data-label="タイトル ✱"><input class="bulk-title${titleHasError ? " input-error" : ""}" rows="2" placeholder="タイトル（必須）" aria-invalid="${titleHasError}">${escHtml(r.title)}</input><div class="bulk-row-errors${hasPending && !hasError ? " pending" : ""}"${rowErrors ? "" : " hidden"}>${escHtml(rowErrors)}</div></td>
      <td class="c-author" data-label="著者"><input class="bulk-author" type="text" value="${escHtml(r.author)}" placeholder="著者" /></td>
      <td class="c-pub" data-label="出版社"><input class="bulk-pub" type="text" value="${escHtml(r.publisher)}" placeholder="出版社" /></td>
      <td class="c-genre" data-label="主属性"><select class="bulk-genre${mainAttributeHasError ? " input-error" : ""}" aria-invalid="${mainAttributeHasError}" required>${buildGenreOptions(r.genre)}</select></td>
      <td class="c-sub-attributes" data-label="副属性"><select class="bulk-sub-attributes${subAttributeHasError ? " input-error" : ""}" aria-invalid="${subAttributeHasError}" required>${buildSubAttributeOptions(r.subAttributeIds || [], r.genre, true)}</select></td>
      <td class="c-rental" data-label="貸出"><select class="bulk-rental"><option value="○"${r.rental === "○" ? " selected" : ""}>○</option><option value="×"${r.rental === "×" ? " selected" : ""}>×</option></select></td>
      <td class="c-loc" data-label="位置"><select class="bulk-location">${locOpts}</select></td>
      <td class="c-del"><button class="btn btn-icon danger" title="削除" onclick="deleteBulkRow(${i})" type="button">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
      </button></td>
    </tr>`;
    })
    .join("");
}

function deleteBulkRow(idx) {
  syncBulkTableToData();
  bulkRows.splice(idx, 1);
  renderBulkTable();
}
window.deleteBulkRow = deleteBulkRow;

/* ============================================================
   位置登録タブ
   ============================================================ */
let locationAssignmentRows = [];
let locationTabInitialized = false;

function normalizeIsbn(isbn) {
  return isbn.replace(/[-\s]/g, "");
}

function getLocationAssignmentTargetOptions() {
  return (
    '<option value="">移動先を選択</option>' +
    '<option value="__none__">（位置なし）</option>' +
    _cache.locations
      .map(
        (location) =>
          `<option value="${location.id}">${escHtml(location.code)}${location.name ? " – " + escHtml(location.name) : ""}</option>`,
      )
      .join("")
  );
}

function updateLocationAssignmentControls() {
  const countEl = document.getElementById("location-assignment-count");
  const updateButton = document.getElementById("btn-location-bulk-update");
  const selectedCount = locationAssignmentRows.filter((row) => row.selected).length;
  if (countEl) countEl.textContent = `${locationAssignmentRows.length}件`;
  if (updateButton) updateButton.disabled = selectedCount === 0;
}

function renderLocationAssignmentList() {
  const tbody = document.getElementById("location-assignment-tbody");
  if (!tbody) return;

  updateLocationAssignmentControls();

  if (!locationAssignmentRows.length) {
    tbody.innerHTML =
      '<tr class="empty-row"><td colspan="5" class="location-assignment-empty">ISBNを入力すると、ここに対象の本が追加されます。</td></tr>';
    return;
  }

  tbody.innerHTML = locationAssignmentRows
    .map((row, index) => {
      const book = _cache.books.find((item) => item.id === row.bookId);
      const currentLocation = book ? getLocationCode(book.locationId) : "";
      return `
        <tr>
          <td class="location-assignment-check la-check" data-label="対象">
            <input type="checkbox" class="location-assignment-checkbox" data-index="${index}"${row.selected ? " checked" : ""} aria-label="${escHtml(row.title)}を変更対象にする" />
          </td>
          <td class="mono la-isbn" data-label="ISBN">${escHtml(row.isbn)}</td>
          <td class="la-title" data-label="タイトル">
            <strong>${escHtml(row.title)}</strong>
            ${row.author ? `<span class="location-assignment-author">${escHtml(row.author)}</span>` : ""}
          </td>
          <td class="la-current" data-label="現在の位置">${escHtml(currentLocation || "位置なし")}</td>
          <td class="location-assignment-action la-remove" data-label="削除">
            <button class="btn btn-icon danger location-assignment-remove" data-index="${index}" type="button" title="対象から削除">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll(".location-assignment-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      const input = event.currentTarget;
      const index = Number(input.dataset.index);
      locationAssignmentRows[index].selected = input.checked;
      updateLocationAssignmentControls();
    });
  });
  tbody.querySelectorAll(".location-assignment-remove").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      locationAssignmentRows.splice(index, 1);
      renderLocationAssignmentList();
    });
  });
}

function initLocationTab() {
  if (locationTabInitialized) {
    renderLocationAssignmentList();
    return;
  }
  locationTabInitialized = true;

  document
    .getElementById("btn-location-row-add")
    .addEventListener("click", () => {
      const tbody = document.getElementById("location-add-tbody");
      const tr = document.createElement("tr");
      tr.innerHTML = `
      <td><input type="text" class="loc-code" placeholder="例: A-1" /></td>
      <td><input type="text" class="loc-name" placeholder="名称（任意）" /></td>
      <td><input type="text" class="loc-memo" placeholder="メモ（任意）" /></td>
      <td><button class="btn btn-icon danger" type="button" onclick="removeLocationRow(this)" title="削除">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
      </button></td>
    `;
      tbody.appendChild(tr);
    });

  document
    .getElementById("btn-location-save")
    .addEventListener("click", async () => {
      const rows = document.querySelectorAll("#location-add-tbody tr");
      const toAdd = [];
      rows.forEach((tr) => {
        const code = tr.querySelector(".loc-code")?.value.trim();
        if (code)
          toAdd.push({
            code,
            name: tr.querySelector(".loc-name")?.value.trim() || null,
            memo: tr.querySelector(".loc-memo")?.value.trim() || null,
          });
      });

      if (!toAdd.length) {
        setResultMsg(
          "location-result-msg",
          "コードを1件以上入力してください。",
          "error",
        );
        return;
      }

      try {
        const { data, error } = await client
          .from("locations")
          .insert(toAdd)
          .select();
        if (error) throw error;
        const added = (data || []).map(rowToLocation);
        _cache.locations.push(...added);
        _cache.locations.sort((a, b) => a.id - b.id);
        setResultMsg(
          "location-result-msg",
          `${added.length}件の位置コードを登録しました。`,
          "success",
        );
        showToast(`${added.length}件の位置コードを登録しました`);
        // 入力欄をリセット（最初の1行を残す）
        const tbody = document.getElementById("location-add-tbody");
        tbody.innerHTML = `<tr>
        <td><input type="text" class="loc-code" placeholder="例: A-1" /></td>
        <td><input type="text" class="loc-name" placeholder="名称（任意）" /></td>
        <td><input type="text" class="loc-memo" placeholder="メモ（任意）" /></td>
        <td><button class="btn btn-icon danger" type="button" onclick="removeLocationRow(this)" title="削除">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button></td>
      </tr>`;
        renderLocationList();
        // 検索・登録フォームの選択肢も更新
        updateAllLocationSelects();
      } catch (err) {
        setResultMsg(
          "location-result-msg",
          `登録に失敗しました: ${err.message}`,
          "error",
        );
      }
    });

  const isbnInput = document.getElementById("location-isbn-input");
  const addIsbnButton = document.getElementById("btn-location-isbn-add");
  const assignmentMessage = document.getElementById("location-assignment-msg");

  const addBookByIsbn = () => {
    const rawIsbn = isbnInput.value.trim();
    const isbn = normalizeIsbn(rawIsbn);
    if (!isbn) {
      assignmentMessage.textContent = "ISBNを入力してください。";
      assignmentMessage.className = "isbn-msg error";
      return;
    }

    const book = _cache.books.find(
      (item) => normalizeIsbn(item.isbn) === isbn,
    );
    if (!book) {
      assignmentMessage.textContent =
        "登録済みの本に該当するISBNがありません。先に書籍を登録してください。";
      assignmentMessage.className = "isbn-msg error";
      return;
    }
    if (locationAssignmentRows.some((row) => row.bookId === book.id)) {
      assignmentMessage.textContent = "この本はすでに対象へ追加されています。";
      assignmentMessage.className = "isbn-msg error";
      return;
    }

    locationAssignmentRows.push({
      bookId: book.id,
      isbn: book.isbn || rawIsbn,
      title: book.title,
      author: book.author,
      selected: true,
    });
    isbnInput.value = "";
    assignmentMessage.textContent = `「${book.title}」を対象に追加しました。`;
    assignmentMessage.className = "isbn-msg success";
    renderLocationAssignmentList();
    scrollTableToBottom("location-assignment-table-wrap");
    isbnInput.focus();
  };

  addIsbnButton.addEventListener("click", addBookByIsbn);
  isbnInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addBookByIsbn();
    }
  });

  const targetSelect = document.getElementById("location-bulk-target");
  targetSelect.addEventListener("focus", () => {
    const previousValue = targetSelect.value;
    targetSelect.innerHTML = getLocationAssignmentTargetOptions();
    targetSelect.value = previousValue;
  });

  document
    .getElementById("btn-location-bulk-update")
    .addEventListener("click", async () => {
      const selectedIds = locationAssignmentRows
        .filter((row) => row.selected)
        .map((row) => row.bookId);
      const targetValue = targetSelect.value;

      if (!selectedIds.length) {
        assignmentMessage.textContent = "変更する本を1冊以上選択してください。";
        assignmentMessage.className = "isbn-msg error";
        return;
      }
      if (!targetValue) {
        assignmentMessage.textContent = "移動先の位置コードを選択してください。";
        assignmentMessage.className = "isbn-msg error";
        return;
      }

      const locationId = targetValue === "__none__" ? null : Number(targetValue);
      const updateButton = document.getElementById("btn-location-bulk-update");
      updateButton.disabled = true;
      updateButton.textContent = "変更中...";
      try {
        await sbBulkUpdateBookLocations(selectedIds, locationId);
        assignmentMessage.textContent = `${selectedIds.length}件の位置を変更しました。`;
        assignmentMessage.className = "isbn-msg success";
        showToast(`${selectedIds.length}件の位置を変更しました`);
        locationAssignmentRows = locationAssignmentRows.filter(
          (row) => !row.selected,
        );
        targetSelect.value = "";
        renderLocationAssignmentList();
        renderSearchTable();
      } catch (err) {
        assignmentMessage.textContent = `位置の変更に失敗しました: ${err.message}`;
        assignmentMessage.className = "isbn-msg error";
        updateLocationAssignmentControls();
      } finally {
        updateButton.textContent = "位置を一括変更";
        updateLocationAssignmentControls();
      }
    });

  renderLocationAssignmentList();
}

function renderLocationList() {
  renderLocationAssignmentList();
}

async function deleteLocation(id) {
  const loc = _cache.locations.find((l) => l.id === id);
  if (!loc) return;
  if (!confirm(`「${loc.code}」を削除しますか？`)) return;
  try {
    const { error } = await client.from("locations").delete().eq("id", id);
    if (error) throw error;
    _cache.locations = _cache.locations.filter((l) => l.id !== id);
    renderLocationList();
    updateAllLocationSelects();
    showToast("位置コードを削除しました", "info");
  } catch (err) {
    showToast(`削除に失敗しました: ${err.message}`, "error");
  }
}
window.deleteLocation = deleteLocation;

function removeLocationRow(btn) {
  btn.closest("tr").remove();
}
window.removeLocationRow = removeLocationRow;

/** 全ての位置選択 <select> を再生成する */
function updateAllLocationSelects() {
  const regSel = document.getElementById("reg-location");
  if (regSel) fillLocationSelect(regSel, regSel.value);

  const editSel = document.getElementById("edit-location");
  if (editSel) fillLocationSelect(editSel, editSel.value);

  // 検索フィルタ（「位置なし」の絞り込みも常に含める）
  const searchSel = document.getElementById("search-location");
  if (searchSel) {
    const prev = getSelectedValues("search-location");
    searchSel.innerHTML = buildSearchLocationOptions(prev);
    syncSearchMultiSelect(searchSel, true);
  }

  // まとめて編集
  const bulkEditSel = document.getElementById("bulk-edit-location");
  if (bulkEditSel) {
    const prev = bulkEditSel.value;
    bulkEditSel.innerHTML =
      '<option value="">変更しない</option>' +
      _cache.locations
        .map(
          (l) =>
            `<option value="${l.id}"${l.id == prev ? " selected" : ""}>${escHtml(l.code)}</option>`,
        )
        .join("");
  }
}

/* ============================================================
   書籍検索タブ
   ============================================================ */
let deleteTargetId = null;
let searchSortKey = "id";
let searchSortDir = "asc";
let selectedBookIds = new Set();
let searchMultiSelectsReady = false;

function getSelectedValues(selectId) {
  const el = document.getElementById(selectId);
  return el
    ? Array.from(el.selectedOptions)
        .map((option) => option.value)
        .filter(Boolean)
    : [];
}

function setSelectedValues(selectEl, values) {
  if (!selectEl) return;
  const valueSet = new Set(values || []);
  Array.from(selectEl.options).forEach((option) => {
    option.selected = valueSet.has(option.value);
  });
  syncSearchMultiSelect(selectEl);
}

const SEARCH_CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>';

function closeSearchMultiSelects(except) {
  document.querySelectorAll(".search-filter-select.is-open").forEach((wrapper) => {
    if (wrapper !== except) {
      wrapper.classList.remove("is-open");
      const trigger = wrapper.querySelector(".search-filter-trigger");
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    }
  });
}

function getSearchMultiSelectSummary(selectEl) {
  const labels = Array.from(selectEl.selectedOptions).map((option) => option.textContent.trim());
  if (!labels.length) return "すべて";
  if (labels.length === 1) return labels[0];
  return `${labels[0]}、ほか${labels.length - 1}件`;
}

function syncSearchMultiSelect(selectEl, rebuild = false) {
  const wrapper = selectEl?.closest(".search-filter-select");
  if (!wrapper) return;
  const summary = wrapper.querySelector(".search-filter-summary");
  const selected = Array.from(selectEl.selectedOptions)
    .map((option) => option.value)
    .filter(Boolean);
  if (summary) {
    summary.textContent = getSearchMultiSelectSummary(selectEl);
    summary.classList.toggle("is-selected", selected.length > 0);
  }
  wrapper.querySelectorAll(".search-filter-option").forEach((optionButton) => {
    const isSelected = selected.includes(optionButton.dataset.value);
    optionButton.classList.toggle("is-selected", isSelected);
    optionButton.setAttribute("aria-selected", String(isSelected));
  });
  if (rebuild) renderSearchMultiSelectOptions(selectEl);
}

function renderSearchMultiSelectOptions(selectEl) {
  const wrapper = selectEl?.closest(".search-filter-select");
  const menu = wrapper?.querySelector(".search-filter-menu");
  if (!menu) return;
  menu.innerHTML = "";
  if (selectEl.id === "search-genre") {
    const tree = document.createElement("ul");
    tree.className = "search-filter-tree";

    const appendOption = (nativeOption, parent) => {
      if (!nativeOption) return;
      const item = document.createElement("li");
      const optionButton = document.createElement("button");
      optionButton.type = "button";
      optionButton.className = "search-filter-option";
      optionButton.dataset.value = nativeOption.value;
      optionButton.setAttribute("role", "option");
      optionButton.setAttribute("aria-selected", String(nativeOption.selected));
      optionButton.tabIndex = -1;
      optionButton.innerHTML = `<span class="search-filter-check">${SEARCH_CHECK_ICON}</span><span class="search-filter-option-label"></span>`;
      optionButton.querySelector(".search-filter-option-label").textContent =
        nativeOption.textContent.trim();
      optionButton.classList.toggle("is-selected", nativeOption.selected);
      parent.appendChild(item);
      item.appendChild(optionButton);
      return item;
    };

    getMainAttributes().forEach((main) => {
      const mainOption = Array.from(selectEl.options).find(
        (option) => option.value === `main:${main.name}`,
      );
      const mainItem = appendOption(mainOption, tree);
      if (!mainItem) return;

      const childOptions = getSubAttributesForMain(main.name)
        .map((attribute) =>
          Array.from(selectEl.options).find(
            (option) => option.value === `sub:${attribute.id}`,
          ),
        )
        .filter(Boolean);
      if (childOptions.length) {
        mainItem.classList.add("has-children");
        mainItem.querySelector(":scope > .search-filter-option").setAttribute("aria-expanded", "false");
        const children = document.createElement("ul");
        children.className = "search-filter-tree-children";
        childOptions.forEach((option) => appendOption(option, children));
        mainItem.appendChild(children);
      }
    });

    const noSubOption = Array.from(selectEl.options).find(
      (option) => option.value === "sub:none",
    );
    appendOption(noSubOption, tree);
    menu.appendChild(tree);
    return;
  }
  Array.from(selectEl.options).forEach((nativeOption) => {
    const optionButton = document.createElement("button");
    optionButton.type = "button";
    optionButton.className = "search-filter-option";
    optionButton.dataset.value = nativeOption.value;
    optionButton.setAttribute("role", "option");
    optionButton.setAttribute("aria-selected", String(nativeOption.selected));
    optionButton.tabIndex = -1;
    optionButton.innerHTML = `<span class="search-filter-check">${SEARCH_CHECK_ICON}</span><span class="search-filter-option-label"></span>`;
    optionButton.querySelector(".search-filter-option-label").textContent =
      nativeOption.textContent;
    optionButton.classList.toggle("is-selected", nativeOption.selected);
    menu.appendChild(optionButton);
  });
}

function focusSearchMenuOption(wrapper, index) {
  const options = [...wrapper.querySelectorAll(".search-filter-option")];
  if (!options.length) return;
  const nextIndex = (index + options.length) % options.length;
  options[nextIndex].focus();
}

function createSearchMultiSelect(selectEl) {
  if (!selectEl || selectEl.closest(".search-filter-select")) return;
  const wrapper = document.createElement("div");
  wrapper.className = "search-filter-select";
  selectEl.parentNode.insertBefore(wrapper, selectEl);
  wrapper.appendChild(selectEl);

  const trigger = document.createElement("button");
  const triggerId = `${selectEl.id}-trigger`;
  const menuId = `${selectEl.id}-menu`;
  trigger.type = "button";
  trigger.id = triggerId;
  trigger.className = "search-filter-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", menuId);
  trigger.setAttribute(
    "aria-label",
    selectEl.closest(".search-attribute-filter")?.querySelector("label")?.textContent.trim() ||
      selectEl.closest(".form-group")?.querySelector("label")?.textContent.trim() ||
      selectEl.closest("td")?.dataset.label ||
      "フィルター",
  );
  trigger.innerHTML =
    '<span class="search-filter-summary"></span><svg class="search-filter-chevron" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

  const menu = document.createElement("div");
  menu.id = menuId;
  menu.className = "search-filter-menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-multiselectable", "true");
  menu.setAttribute("tabindex", "-1");
  wrapper.append(trigger, menu);

  const setOpen = (open) => {
    if (open) closeSearchMultiSelects(wrapper);
    wrapper.classList.toggle("is-open", open);
    trigger.setAttribute("aria-expanded", String(open));
  };

  trigger.addEventListener("click", () => setOpen(!wrapper.classList.contains("is-open")));
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
      focusSearchMenuOption(
        wrapper,
        Math.max(0, Array.from(selectEl.selectedOptions).length - 1),
      );
    }
    if (event.key === "Escape") setOpen(false);
  });
  menu.addEventListener("click", (event) => {
    const optionButton = event.target.closest(".search-filter-option");
    if (!optionButton) return;
    const nativeOption = Array.from(selectEl.options).find(
      (option) => option.value === optionButton.dataset.value,
    );
    if (!nativeOption) return;
    const parentItem = optionButton.closest(".search-filter-tree > li.has-children");
    if (parentItem) {
      const wasExpanded = parentItem.classList.contains("is-expanded");
      menu.querySelectorAll(".search-filter-tree > li.is-expanded").forEach((item) => {
        item.classList.remove("is-expanded");
        item.querySelector(":scope > .search-filter-option")?.setAttribute("aria-expanded", "false");
      });
      if (!wasExpanded) {
        parentItem.classList.add("is-expanded");
        optionButton.setAttribute("aria-expanded", "true");
      } else {
        optionButton.setAttribute("aria-expanded", "false");
      }
    }
    nativeOption.selected = !nativeOption.selected;
    syncSearchMultiSelect(selectEl);
    selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    if (!parentItem) trigger.focus();
  });
  menu.addEventListener("keydown", (event) => {
    const options = [...wrapper.querySelectorAll(".search-filter-option")];
    const currentIndex = options.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusSearchMenuOption(wrapper, currentIndex + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Home") {
      event.preventDefault();
      focusSearchMenuOption(wrapper, 0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusSearchMenuOption(wrapper, options.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      trigger.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      document.activeElement.click();
    }
  });

  renderSearchMultiSelectOptions(selectEl);
  syncSearchMultiSelect(selectEl);
}

function enhanceSearchMultiSelects() {
  document.querySelectorAll(".search-multi-select").forEach(createSearchMultiSelect);
  if (searchMultiSelectsReady) return;
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-filter-select")) closeSearchMultiSelects();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSearchMultiSelects();
  });
  searchMultiSelectsReady = true;
}

function getSelectedValuesFromElement(selectEl) {
  return selectEl
    ? Array.from(selectEl.selectedOptions)
        .map((option) => option.value)
        .filter(Boolean)
    : [];
}

function buildSearchGenreOptions(selectedValues = []) {
  const selected = new Set(selectedValues);
  const options = [];
  getMainAttributes().forEach((main) => {
    const children = getSubAttributesForMain(main.name).sort((a, b) =>
      a.name.localeCompare(b.name, "ja"),
    );
    options.push(
      `<option value="main:${escHtml(main.name)}"${selected.has(`main:${main.name}`) ? " selected" : ""}>${escHtml(main.name)}</option>`,
    );
    children.forEach((attribute) => {
      options.push(
        `<option value="sub:${attribute.id}"${selected.has(`sub:${attribute.id}`) ? " selected" : ""}>${escHtml(attribute.name)}${attribute.is_r18 ? "（R18）" : ""}</option>`,
      );
    });
  });
  options.push(
    `<option value="sub:none"${selected.has("sub:none") ? " selected" : ""}>副属性なし</option>`,
  );
  return options.join("");
}

function buildSearchRentalOptions(selectedValues = []) {
  const options = [
    ["__available__", "○（可）"],
    ["__unavailable__", "×（不可）"],
    ["__purchase_planned__", "購入予定"],
    ["__provisional__", "仮登録（配達待ち）"],
    ["__out_of_stock__", "在庫0"],
  ];
  const valueSet = new Set(selectedValues);
  return options
    .map(
      ([value, label]) => `<option value="${value}"${valueSet.has(value) ? " selected" : ""}>${label}</option>`,
    )
    .join("");
}

function buildSearchLocationOptions(selectedValues = []) {
  const valueSet = new Set(selectedValues);
  return [
    `<option value="__none__"${valueSet.has("__none__") ? " selected" : ""}>位置なし</option>`,
    ..._cache.locations.map(
      (l) => `<option value="${l.id}"${valueSet.has(String(l.id)) ? " selected" : ""}>${escHtml(l.code)}</option>`,
    ),
  ].join("");
}

function isSearchAvailableBook(book) {
  return (
    getBookState(book) === BOOK_STATES.NORMAL &&
    book.rental === "○" &&
    (book.stock || 0) > 0
  );
}

function isSearchUnavailableBook(book) {
  return (
    getBookState(book) === BOOK_STATES.NORMAL &&
    !isSearchAvailableBook(book)
  );
}

function updatePrintSelectedButton() {
  const button = document.getElementById("btn-print-selected");
  if (!button) return;
  const count = selectedBookIds.size;
  button.disabled = count === 0;
  button.title = count ? `${count}件のISBNを印刷` : "印刷する本を選択してください";
}

const D30_SERVICE_UUID = "0000ff00-0000-1000-8000-00805f9b34fb";
const D30_CHARACTERISTIC_UUID = "0000ff02-0000-1000-8000-00805f9b34fb";
const D30_PACKET_SIZE = 128;

function createD30LabelCanvas(isbn) {
  if (!window.JsBarcode) {
    throw new Error("バーコード生成ライブラリを読み込めませんでした。ページを再読み込みしてください。");
  }

  // D30へ送る画像は「横幅÷8バイト × 縦幅」で作り、プリンター側で
  // 40mm幅・12mm高さになるよう、描画時だけ90度回転させる。
  const canvas = document.createElement("canvas");
  canvas.width = 12 * 8;
  canvas.height = 40 * 8;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const barcodeCanvas = document.createElement("canvas");
  const barcodeValue = normalizeIsbn(isbn);
  window.JsBarcode(barcodeCanvas, barcodeValue, {
    format: "CODE128",
    width: 2,
    height: 56,
    displayValue: false,
    margin: 0,
  });

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.imageSmoothingEnabled = false;
  const maxWidth = canvas.height - 16;
  const maxHeight = canvas.width - 34;
  const scale = Math.min(1, maxWidth / barcodeCanvas.width, maxHeight / barcodeCanvas.height);
  const drawWidth = Math.round(barcodeCanvas.width * scale);
  const drawHeight = Math.round(barcodeCanvas.height * scale);
  ctx.drawImage(barcodeCanvas, -drawWidth / 2, -45, drawWidth, drawHeight);

  // JsBarcodeの表示文字を縮小画像に含めず、D30の実ドット上へ直接描画する。
  // 24px太字にすることで、12mmラベルでも数字を読み取りやすくする。
  const textSize = barcodeValue.length > 13 ? 20 : 24;
  ctx.fillStyle = "#000";
  ctx.font = `bold ${textSize}px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(barcodeValue, 0, 45);
  ctx.restore();
  return canvas;
}

function getD30PrintData(canvas) {
  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const bytesPerRow = canvas.width / 8;
  const data = new Uint8Array(bytesPerRow * canvas.height + 8);
  let offset = 0;
  const whitePixel = (x, y) => {
    const index = (canvas.width * y + x) * 4;
    return imageData[index] + imageData[index + 1] + imageData[index + 2] > 0 ? 0 : 1;
  };

  for (let y = 0; y < canvas.height; y += 1) {
    for (let byteIndex = 0; byteIndex < bytesPerRow; byteIndex += 1) {
      const x = byteIndex * 8;
      data[offset++] =
        whitePixel(x, y) * 128 +
        whitePixel(x + 1, y) * 64 +
        whitePixel(x + 2, y) * 32 +
        whitePixel(x + 3, y) * 16 +
        whitePixel(x + 4, y) * 8 +
        whitePixel(x + 5, y) * 4 +
        whitePixel(x + 6, y) * 2 +
        whitePixel(x + 7, y);
    }
  }
  return data;
}

function d30Header(canvas, data) {
  const mmWidth = canvas.width / 8;
  const bytes = data.length / mmWidth;
  return new Uint8Array([
    0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00,
    mmWidth % 256, Math.floor(mmWidth / 256),
    bytes % 256, Math.floor(bytes / 256),
  ]);
}

async function d30Write(characteristic, bytes) {
  for (let offset = 0; offset < bytes.length; offset += D30_PACKET_SIZE) {
    const chunk = bytes.slice(offset, offset + D30_PACKET_SIZE);
    if (characteristic.writeValueWithResponse) {
      await characteristic.writeValueWithResponse(chunk);
    } else {
      await characteristic.writeValue(chunk);
    }
  }
}

async function printCanvasToD30(characteristic, canvas) {
  const data = getD30PrintData(canvas);
  await d30Write(characteristic, d30Header(canvas, data));
  await d30Write(characteristic, data);
  await d30Write(characteristic, new Uint8Array([0x1b, 0x64, 0x00]));
}

async function printSelectedBooks() {
  const selectedBooks = getBooks().filter((book) => selectedBookIds.has(book.id));
  if (!selectedBooks.length) {
    alert("印刷する本を選択してください。");
    return;
  }
  const booksWithoutIsbn = selectedBooks.filter((book) => !normalizeIsbn(book.isbn));
  if (booksWithoutIsbn.length) {
    alert(`ISBNが登録されていない本が含まれています。\n${booksWithoutIsbn.map((book) => book.title).join("\n")}`);
    return;
  }
  if (!navigator.bluetooth) {
    alert("このブラウザはWeb Bluetoothに対応していません。ChromeまたはEdgeで、D30を接続してお試しください。");
    return;
  }

  const summary = selectedBooks
    .map((book, index) => `${index + 1}. ${book.title}（${book.isbn || "ISBNなし"}）`)
    .join("\n");
  if (!window.confirm(`以下の${selectedBooks.length}件を印刷しますか？\n\n${summary}`)) {
    return;
  }

  const button = document.getElementById("btn-print-selected");
  const originalButtonHtml = button?.innerHTML;
  let device = null;
  if (button) {
    button.disabled = true;
    button.textContent = "接続中…";
  }

  try {
    device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [D30_SERVICE_UUID],
    });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(D30_SERVICE_UUID);
    const characteristic = await service.getCharacteristic(D30_CHARACTERISTIC_UUID);

    for (const book of selectedBooks) {
      await printCanvasToD30(characteristic, createD30LabelCanvas(book.isbn));
    }
    alert(`${selectedBooks.length}件のラベルをD30へ送信しました。`);
  } catch (error) {
    if (error?.name !== "NotFoundError" && error?.name !== "AbortError") {
      console.error("D30印刷エラー", error);
      alert(`D30へ印刷できませんでした。\n${error?.message || "D30が接続されているか確認してください。"}`);
    }
  } finally {
    if (device?.gatt?.connected) {
      device.gatt.disconnect();
    }
    if (button) {
      button.innerHTML = originalButtonHtml || "D30印刷";
      updatePrintSelectedButton();
    }
  }
}

function initSearchTab() {
  const searchGenreSel = document.getElementById("search-genre");
  const searchRentalSel = document.getElementById("search-rental");
  const searchLocationSel = document.getElementById("search-location");
  searchGenreSel.innerHTML = buildSearchGenreOptions();
  searchRentalSel.innerHTML = buildSearchRentalOptions();
  searchLocationSel.innerHTML = buildSearchLocationOptions();
  enhanceSearchMultiSelects();

  fillGenreSelect(document.getElementById("edit-genre"), GENRES[0]);
  document.getElementById("edit-genre").addEventListener("change", (event) => {
    const select = document.getElementById("edit-sub-attributes");
    updateSubAttributeSelect(select, event.target.value, [select.value], true);
  });

  const bulkEditGenre = document.getElementById("bulk-edit-genre");
  bulkEditGenre.addEventListener("change", () => {
    const select = document.getElementById("bulk-edit-sub-attributes");
    updateSubAttributeSelect(
      select,
      bulkEditGenre.value,
      [select.value],
      false,
    );
  });

  // クリアボタン（旧・検索ボタン）
  document.getElementById("btn-search").addEventListener("click", () => {
    document.getElementById("search-kw").value = "";
    setSelectedValues(document.getElementById("search-genre"), []);
    setSelectedValues(document.getElementById("search-rental"), []);
    setSelectedValues(document.getElementById("search-location"), []);
    selectedBookIds.clear();
    document.getElementById("search-table").style.width = "";
    document.querySelectorAll("#search-table colgroup col").forEach((col) => {
      col.style.width = "";
    });
    document.querySelectorAll("#search-table thead th").forEach((th) => {
      th.style.width = th.dataset.defaultWidth || "";
    });
    renderSearchTable();
  });

  // キーワード変更は入力ごとに即時反映する
  document.getElementById("search-kw").addEventListener("input", () => {
    renderSearchTable();
  });

  // セレクト変更で即検索
  ["search-genre", "search-rental", "search-location"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", renderSearchTable);
  });

  // 全選択チェックボックス
  document
    .getElementById("search-select-all")
    .addEventListener("change", function () {
      const books = getFilteredSortedBooks();
      if (this.checked) {
        books.forEach((b) => selectedBookIds.add(b.id));
      } else {
        books.forEach((b) => selectedBookIds.delete(b.id));
      }
      renderSearchTable();
    });

  document
    .getElementById("btn-print-selected")
    .addEventListener("click", printSelectedBooks);

  // モーダル
  document
    .getElementById("btn-modal-close")
    .addEventListener("click", closeEditModal);
  document
    .getElementById("btn-modal-cancel")
    .addEventListener("click", closeEditModal);
  document
    .getElementById("btn-del-close")
    .addEventListener("click", closeDeleteModal);
  document
    .getElementById("btn-del-cancel")
    .addEventListener("click", closeDeleteModal);
  document
    .getElementById("btn-modal-save")
    .addEventListener("click", saveEditBook);
  document
    .getElementById("btn-del-confirm")
    .addEventListener("click", confirmDeleteBook);

  // ソート
  document
    .querySelectorAll("#search-table thead th[data-sort]")
    .forEach((th) => {
      th.addEventListener("click", (e) => {
        if (e.target.closest(".th-resizer")) return;
        const key = th.dataset.sort;
        if (key === "row") return;
        searchSortDir =
          searchSortKey === key && searchSortDir === "asc" ? "desc" : "asc";
        searchSortKey = key;
        document
          .querySelectorAll("#search-table thead th[data-sort]")
          .forEach((h) => h.classList.remove("sorted-asc", "sorted-desc"));
        th.classList.add(
          searchSortDir === "asc" ? "sorted-asc" : "sorted-desc",
        );
        renderSearchTable();
      });
    });

  // まとめて編集
  document
    .getElementById("btn-bulk-edit")
    .addEventListener("click", openBulkEditModal);
  document
    .getElementById("btn-bulk-edit-close")
    .addEventListener("click", closeBulkEditModal);
  document
    .getElementById("btn-bulk-edit-cancel")
    .addEventListener("click", closeBulkEditModal);
  document
    .getElementById("btn-bulk-edit-apply")
    .addEventListener("click", applyBulkEdit);

  // 状態変更パネル
  document
    .getElementById("btn-state-change")
    .addEventListener("click", openStateChangePanel);
  document
    .getElementById("btn-state-change-close")
    .addEventListener("click", closeStateChangePanel);
  document
    .getElementById("btn-state-change-cancel")
    .addEventListener("click", closeStateChangePanel);
  document
    .getElementById("btn-state-change-apply")
    .addEventListener("click", applyStateChange);
  document
    .getElementById("state-change-list")
    .addEventListener("click", (event) => {
      const button = event.target.closest(".state-choice");
      if (!button) return;
      const row = button.closest(".state-change-row");
      if (!row) return;
      row.querySelectorAll(".state-choice").forEach((choice) => {
        const isActive = choice === button;
        choice.classList.toggle("is-active", isActive);
        choice.setAttribute("aria-pressed", String(isActive));
      });
    });
  document
    .getElementById("btn-state-change-all")
    .addEventListener("click", () => {
      const state = document.getElementById("state-change-all").value;
      if (!state) return;
      document.querySelectorAll(".state-change-row").forEach((row) => {
        const button = row.querySelector(`.state-choice[data-state="${state}"]`);
        if (!button) return;
        row.querySelectorAll(".state-choice").forEach((choice) => {
          const isActive = choice === button;
          choice.classList.toggle("is-active", isActive);
          choice.setAttribute("aria-pressed", String(isActive));
        });
      });
    });

  // 貸出パネル
  document
    .getElementById("btn-quick-loan")
    .addEventListener("click", openLoanPanel);
  document
    .getElementById("btn-loan-panel-close")
    .addEventListener("click", closeLoanPanel);
  document
    .getElementById("btn-loan-panel-cancel")
    .addEventListener("click", closeLoanPanel);
  document
    .getElementById("btn-loan-panel-exec")
    .addEventListener("click", execLoanPanel);

  // 返却パネル
  document
    .getElementById("btn-quick-return")
    .addEventListener("click", openReturnPanel);
  document
    .getElementById("btn-return-panel-close")
    .addEventListener("click", closeReturnPanel);
  document
    .getElementById("btn-return-panel-cancel")
    .addEventListener("click", closeReturnPanel);
  document
    .getElementById("btn-return-panel-exec")
    .addEventListener("click", execReturnPanel);

  document
    .getElementById("return-panel-select-all")
    .addEventListener("change", function () {
      document.querySelectorAll(".return-panel-cb").forEach((cb) => {
        cb.checked = this.checked;
      });
    });

  const bulkGenreSel = document.getElementById("bulk-edit-genre");
  bulkGenreSel.innerHTML =
    '<option value="">変更しない</option>' +
    GENRES.map(
      (g) => `<option value="${escHtml(g)}">${escHtml(g)}</option>`,
    ).join("");
  fillSubAttributeSelect(document.getElementById("bulk-edit-sub-attributes"));
  document.getElementById("edit-state").addEventListener("change", () => {
    syncEditBookState(true);
  });

  // 列リサイズ初期化
  initColumnResize("search-table");
}

/* 列リサイズハンドル */
function initColumnResize(tableId) {
  const table = document.getElementById(tableId);
  if (!table) return;
  table.querySelectorAll("thead th").forEach((th) => {
    if (th.dataset.defaultWidth === undefined) {
      th.dataset.defaultWidth = th.style.width;
    }
  });
  const columns = Array.from(table.querySelectorAll("thead th"));
  let colgroup = table.querySelector("colgroup");
  if (!colgroup) {
    colgroup = document.createElement("colgroup");
    columns.forEach(() => colgroup.appendChild(document.createElement("col")));
    table.insertBefore(colgroup, table.firstChild);
  }
  const columnElements = Array.from(colgroup.children);
  columns.forEach((th, index) => {
    if (th.dataset.sort === "row") return;
    th.style.position = "relative";
    const existing = th.querySelector(".th-resizer");
    if (existing) existing.remove();
    const resizer = document.createElement("div");
    resizer.className = "th-resizer";
    th.appendChild(resizer);

    let startX, startW;
    resizer.addEventListener("mousedown", (e) => {
      const widths = columns.map((column) => column.getBoundingClientRect().width);
      columns.forEach((column, columnIndex) => {
        columnElements[columnIndex].style.width = `${widths[columnIndex]}px`;
      });
      table.style.width = `${Math.ceil(widths.reduce((sum, width) => sum + width, 0))}px`;
      startX = e.clientX;
      startW = widths[index];
      e.preventDefault();
      e.stopPropagation();
      const onMove = (e2) => {
        widths[index] = Math.max(40, startW + e2.clientX - startX);
        columnElements[index].style.width = `${widths[index]}px`;
        table.style.width = `${Math.ceil(widths.reduce((sum, width) => sum + width, 0))}px`;
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  });
}

function getFilteredSortedBooks() {
  const kw = (document.getElementById("search-kw")?.value || "").toLowerCase();
  const selectedGenres = getSelectedValues("search-genre");
  const rentalStates = getSelectedValues("search-rental");
  const locIds = getSelectedValues("search-location");

  let books = getBooks().filter((b) => {
    if (selectedGenres.length && !selectedGenres.some((genre) =>
      genre.startsWith("main:")
        ? genre.slice(5) === b.genre
        : genre === "sub:none"
          ? !(b.subAttributeIds || []).length
        : (b.subAttributeIds || []).includes(Number(genre.slice(4))),
    )) {
      return false;
    }

    if (rentalStates.length) {
      const matchesRental = rentalStates.some((state) => {
        if (state === "__available__") return isSearchAvailableBook(b);
        if (state === "__unavailable__") return isSearchUnavailableBook(b);
        if (state === "__purchase_planned__") return isPurchasePlannedBook(b);
        if (state === "__provisional__") return isProvisionalBook(b);
        if (state === "__out_of_stock__") return b.stock === 0;
        return false;
      });
      if (!matchesRental) return false;
    }

    if (locIds.length) {
      const matchesLocation = locIds.some((locId) => {
        if (locId === "__none__") return !b.locationId;
        return String(b.locationId) === locId;
      });
      if (!matchesLocation) return false;
    }

    if (
      kw &&
      ![b.title, b.author, b.publisher, b.isbn].some((v) =>
        (v || "").toLowerCase().includes(kw),
      )
    )
      return false;
    return true;
  });

  books.sort((a, b) => {
    const dir = searchSortDir === "asc" ? 1 : -1;
    const key = searchSortKey;
    let va, vb;
    if (key === "stock") {
      va = a.stock || 0;
      vb = b.stock || 0;
    } else if (key === "id") {
      va = a.id;
      vb = b.id;
    } else if (key === "location") {
      va = getLocationCode(a.locationId);
      vb = getLocationCode(b.locationId);
    } else if (key === "genre") {
      const getGenreSortValue = (book) => {
        const subAttribute = (book.subAttributeIds || [])
          .map((id) =>
            _cache.attributes.find(
              (attribute) => Number(attribute.id) === Number(id),
            )?.name || "",
          )
          .join(" ");
        return `${book.genre || ""}\u0000${subAttribute}`.toLowerCase();
      };
      va = getGenreSortValue(a);
      vb = getGenreSortValue(b);
    } else {
      va = (a[key] || "").toLowerCase();
      vb = (b[key] || "").toLowerCase();
    }
    return va < vb ? -1 * dir : va > vb ? 1 * dir : 0;
  });

  return books;
}

function renderSearchTable() {
  const books = getFilteredSortedBooks();
  const count = document.getElementById("search-count");
  if (count) count.textContent = `${books.length}件`;

  // 全選択チェックボックスの状態更新
  const selectAll = document.getElementById("search-select-all");
  if (selectAll) {
    const allSelected =
      books.length > 0 && books.every((b) => selectedBookIds.has(b.id));
    selectAll.checked = allSelected;
    selectAll.indeterminate =
      !allSelected && books.some((b) => selectedBookIds.has(b.id));
  }
  updatePrintSelectedButton();
  const actions = document.getElementById("search-actions");
  if (actions) actions.hidden = selectedBookIds.size === 0;

  const tbody = document.getElementById("search-tbody");
  if (!books.length) {
    tbody.innerHTML =
      '<tr class="empty-row"><td colspan="11">条件に一致する書籍が見つかりませんでした。</td></tr>';
    return;
  }

  tbody.innerHTML = books
    .map((b, idx) => {
      const isSel = selectedBookIds.has(b.id);
      const pendingState = getBookState(b);
      const isPurchasePlanned = pendingState === BOOK_STATES.PURCHASE_PLANNED;
      const isProvisional = pendingState === BOOK_STATES.PROVISIONAL;
      const rowClasses = [
        isSel ? "row-selected" : "",
        isPurchasePlanned ? "row-purchase-planned" : "",
        isProvisional ? "row-provisional" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const rowStyle = isPurchasePlanned
        ? ' style="background-color:#eaecfd;color:#000;"'
        : isProvisional
          ? ' style="background-color:#fdecea;"'
          : "";
      const titleStyle = isPurchasePlanned ? ' style="color:#000;"' : "";
      const locCode = escHtml(getLocationCode(b.locationId) || "—");
      const mainAttribute =
        _cache.attributes.find(
          (attribute) => Number(attribute.id) === Number(b.mainAttributeId),
        )?.name || b.genre || "—";
      const subAttributes = (b.subAttributeIds || [])
        .map((id) =>
          _cache.attributes.find(
            (attribute) => Number(attribute.id) === Number(id),
          ),
        )
        .filter(Boolean)
        .map((attribute) => `${attribute.name}${attribute.is_r18 ? "（R18）" : ""}`);
      return `<tr class="${rowClasses}"${rowStyle} onclick="toggleSearchSelect(${b.id})">
      <td class="c-no mono" style="text-align:center;">${idx + 1}</td>
      <td class="c-loc" data-label="位置"><span class="mono">${locCode}</span></td>
      <td class="c-title" data-label="タイトル">
        <button class="title-link"${titleStyle} onclick="event.stopPropagation();openEditModal(${b.id})">
          ${escHtml(b.title)}
        </button>
      </td>
      <td class="c-author" data-label="著者">${escHtml(b.author || "—")}</td>
      <td class="c-pub" data-label="出版社">${escHtml(b.publisher || "—")}</td>
      <td class="c-genre split-cell" data-label="ジャンル">
        <div class="cell-container">
          <div class="top-item" data-label="主属性">${escHtml(mainAttribute)}</div>
          <div class="bottom-item" data-label="副属性">${subAttributes.length ? subAttributes.map((attribute) => `<span class="search-sub-attribute">${escHtml(attribute)}</span>`).join("") : "—"}</div>
        </div>
      </td>
      <td class="c-isbn mono" data-label="ISBN">${escHtml(b.isbn || "—")}</td>
      <td class="c-stock" data-label="在庫" style="text-align:center;">${b.stock}</td>
      <td class="c-rental" data-label="貸出" style="text-align:center;">${escHtml(b.rental || "—")}</td>
      <td class="c-check" onclick="event.stopPropagation()">
        <input type="checkbox" class="search-select" data-id="${b.id}"
          ${isSel ? "checked" : ""}
          onchange="updateSearchSelect(${b.id}, this.checked)" />
      </td>
      <td class="c-del" onclick="event.stopPropagation()">
        <div class="action-cell">
          <button class="btn btn-icon danger" title="削除" onclick="openDeleteModal(${b.id})">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
    })
    .join("");
}

function toggleSearchSelect(id) {
  if (selectedBookIds.has(id)) selectedBookIds.delete(id);
  else selectedBookIds.add(id);
  const cb = document.querySelector(`.search-select[data-id="${id}"]`);
  if (cb) {
    cb.checked = selectedBookIds.has(id);
    const tr = cb.closest("tr");
    if (tr) tr.classList.toggle("row-selected", selectedBookIds.has(id));
  }
  const selectAll = document.getElementById("search-select-all");
  if (selectAll) {
    const visible = getFilteredSortedBooks();
    const allSel =
      visible.length > 0 && visible.every((b) => selectedBookIds.has(b.id));
    selectAll.checked = allSel;
    selectAll.indeterminate =
      !allSel && visible.some((b) => selectedBookIds.has(b.id));
  }
  updatePrintSelectedButton();
  const actions = document.getElementById("search-actions");
  if (actions) actions.hidden = selectedBookIds.size === 0;
}
window.toggleSearchSelect = toggleSearchSelect;

function updateSearchSelect(id, checked) {
  if (checked) selectedBookIds.add(id);
  else selectedBookIds.delete(id);
  updatePrintSelectedButton();
  const actions = document.getElementById("search-actions");
  if (actions) actions.hidden = selectedBookIds.size === 0;
  const tr = document
    .querySelector(`.search-select[data-id="${id}"]`)
    ?.closest("tr");
  if (tr) tr.classList.toggle("row-selected", checked);
  const visible = getFilteredSortedBooks();
  const selectAll = document.getElementById("search-select-all");
  if (selectAll) {
    const allSelected =
      visible.length > 0 && visible.every((book) => selectedBookIds.has(book.id));
    selectAll.checked = allSelected;
    selectAll.indeterminate =
      !allSelected && visible.some((book) => selectedBookIds.has(book.id));
  }
}
window.updateSearchSelect = updateSearchSelect;

function getSelectedSearchIds() {
  return Array.from(selectedBookIds);
}

function openEditModal(id) {
  const book = getBooks().find((b) => b.id === id);
  if (!book) return;
  document.getElementById("edit-id").value = book.id;
  document.getElementById("edit-title").value = book.title || "";
  document.getElementById("edit-author").value = book.author || "";
  document.getElementById("edit-publisher").value = book.publisher || "";
  document.getElementById("edit-isbn").value = book.isbn || "";
  fillGenreSelect(document.getElementById("edit-genre"), book.genre);
  fillSubAttributeSelect(
    document.getElementById("edit-sub-attributes"),
    book.subAttributeIds,
    book.genre,
    true,
  );
  document.getElementById("edit-stock").value = book.stock ?? 1;
  document.getElementById("edit-rental").value = book.rental || "○";
  fillLocationSelect(document.getElementById("edit-location"), book.locationId);
  document.getElementById("edit-state").value = getBookState(book);
  syncEditBookState(false);
  document.getElementById("edit-memo").value = book.memo || "";
  document.getElementById("modal-edit").hidden = false;
}
window.openEditModal = openEditModal;

function syncEditBookState(resetNormal) {
  const pending =
    document.getElementById("edit-state").value !== BOOK_STATES.NORMAL;
  const stock = document.getElementById("edit-stock");
  const rental = document.getElementById("edit-rental");
  const location = document.getElementById("edit-location");
  stock.disabled = pending;
  rental.disabled = pending;
  location.disabled = pending;
  if (pending) {
    stock.value = "0";
    rental.value = "×";
    location.value = "";
  } else if (resetNormal) {
    stock.value = "1";
    rental.value = "○";
  }
}

function closeEditModal() {
  document.getElementById("modal-edit").hidden = true;
}

async function saveEditBook() {
  const id = parseInt(document.getElementById("edit-id").value);
  const title = document.getElementById("edit-title").value.trim();
  if (!title) {
    alert("タイトルは必須です。");
    return;
  }
  const genre = document.getElementById("edit-genre").value;
  const subAttributeIds = getSelectedValues("edit-sub-attributes").map(Number);
  if (!genre || !subAttributeIds.length) {
    alert("主属性と副属性は両方必須です。");
    return;
  }
  if (!isSubAttributeAllowedForMain(subAttributeIds[0], genre)) {
    alert("選択した副属性はこの主属性に属していません。");
    return;
  }

  const locationId =
    parseInt(document.getElementById("edit-location").value) || null;
  const changes = {
    title,
    author: document.getElementById("edit-author").value.trim(),
    publisher: document.getElementById("edit-publisher").value.trim(),
    isbn: document.getElementById("edit-isbn").value.trim(),
    genre,
    subAttributeIds,
    state: document.getElementById("edit-state").value,
    stock: document.getElementById("edit-state").value === BOOK_STATES.NORMAL
      ? parseInt(document.getElementById("edit-stock").value) || 0
      : 0,
    rental: document.getElementById("edit-state").value === BOOK_STATES.NORMAL
      ? document.getElementById("edit-rental").value
      : "×",
    memo: document.getElementById("edit-memo").value.trim(),
    location_id:
      document.getElementById("edit-state").value === BOOK_STATES.NORMAL
        ? locationId
        : null,
  };

  try {
    await sbUpdateBook(id, changes);
    closeEditModal();
    renderSearchTable();
    showToast("書籍情報を更新しました");
  } catch (err) {
    alert("更新に失敗しました。");
    console.error(err);
  }
}

function openDeleteModal(id) {
  deleteTargetId = id;
  const book = getBooks().find((b) => b.id === id);
  document.getElementById("del-confirm-msg").textContent =
    `「${book ? book.title : ""}」を削除してもよろしいですか？`;
  document.getElementById("modal-delete").hidden = false;
}
window.openDeleteModal = openDeleteModal;

function closeDeleteModal() {
  document.getElementById("modal-delete").hidden = true;
  deleteTargetId = null;
}

async function confirmDeleteBook() {
  if (deleteTargetId == null) return;
  const id = deleteTargetId;
  try {
    await sbDeleteBook(id);
    selectedBookIds.delete(id);
    closeDeleteModal();
    renderSearchTable();
    showToast("書籍を削除しました", "info");
  } catch (err) {
    alert("削除に失敗しました。");
    console.error(err);
  }
}

function openBulkEditModal() {
  const ids = getSelectedSearchIds();
  if (!ids.length) {
    alert("まとめて編集する書籍を選択してください。");
    return;
  }
  ["bulk-edit-author", "bulk-edit-publisher", "bulk-edit-memo"].forEach(
    (id) => {
      document.getElementById(id).value = "";
    },
  );
  document.getElementById("bulk-edit-genre").value = "";
  setSelectedValues(document.getElementById("bulk-edit-sub-attributes"), []);
  document.getElementById("bulk-edit-rental").value = "";
  document.getElementById("bulk-edit-stock").value = "";
  fillLocationSelect(document.getElementById("bulk-edit-location"), null);
  document.getElementById("modal-bulk-edit").hidden = false;
}

function renderStateChangePanel() {
  const list = document.getElementById("state-change-list");
  if (!list) return;

  const books = getBooks().filter((book) => selectedBookIds.has(book.id));
  list.innerHTML = books
    .map((book) => {
      const currentState = getBookState(book);
      const choices = BOOK_STATE_OPTIONS.map(
        (state) => `
          <button
            type="button"
            class="state-choice state-choice--${state}${state === currentState ? " is-active" : ""}"
            data-state="${state}"
            aria-pressed="${state === currentState}"
          >
            ${BOOK_STATE_LABELS[state]}
          </button>`,
      ).join("");

      return `
        <div class="state-change-row" data-book-id="${book.id}">
          <div class="state-change-title" title="${escHtml(book.title)}">${escHtml(book.title)}</div>
          <div class="state-choice-group" role="group" aria-label="${escHtml(book.title)}の状態">
            ${choices}
          </div>
        </div>`;
    })
    .join("");
}

function openStateChangePanel() {
  const ids = getSelectedSearchIds();
  if (!ids.length) {
    alert("状態を変更する書籍を選択してください。");
    return;
  }
  renderStateChangePanel();
  document.getElementById("state-change-all").value = "";
  document.getElementById("modal-state-change").hidden = false;
}

function closeStateChangePanel() {
  document.getElementById("modal-state-change").hidden = true;
}

async function applyStateChange() {
  const rows = Array.from(document.querySelectorAll(".state-change-row"));
  if (!rows.length) {
    closeStateChangePanel();
    return;
  }

  const applyButton = document.getElementById("btn-state-change-apply");
  if (applyButton) {
    applyButton.disabled = true;
    applyButton.textContent = "更新中…";
  }

  try {
    await Promise.all(
      rows.map((row) => {
        const id = parseInt(row.dataset.bookId, 10);
        const state = row.querySelector(".state-choice.is-active")?.dataset.state;
        const book = getBooks().find((item) => item.id === id);
        if (!book || !BOOK_STATE_OPTIONS.includes(state)) {
          throw new Error("状態変更の対象が見つかりません。");
        }
        return sbUpdateBook(
          id,
          state === BOOK_STATES.NORMAL
            ? { state }
            : { state, stock: 0, rental: "×", location_id: null },
        );
      }),
    );
    closeStateChangePanel();
    renderSearchTable();
    showToast(`${rows.length}件の状態を更新しました`);
  } catch (err) {
    alert("状態の更新に失敗しました。");
    console.error(err);
  } finally {
    if (applyButton) {
      applyButton.disabled = false;
      applyButton.textContent = "状態を更新する";
    }
  }
}

function closeBulkEditModal() {
  document.getElementById("modal-bulk-edit").hidden = true;
}

async function applyBulkEdit() {
  const ids = getSelectedSearchIds();
  if (!ids.length) {
    alert("対象が選択されていません。");
    return;
  }
  const author = document.getElementById("bulk-edit-author").value.trim();
  const publisher = document.getElementById("bulk-edit-publisher").value.trim();
  const genre = document.getElementById("bulk-edit-genre").value;
  const rental = document.getElementById("bulk-edit-rental").value;
  const stockStr = document.getElementById("bulk-edit-stock").value;
  const memo = document.getElementById("bulk-edit-memo").value.trim();
  const locVal = document.getElementById("bulk-edit-location").value;
  const subAttributeIds = getSelectedValues("bulk-edit-sub-attributes").map(Number);
  const replaceSubAttributes = subAttributeIds.length > 0;

  if (
    !author &&
    !publisher &&
    !genre &&
    !rental &&
    !stockStr &&
    !memo &&
    !locVal &&
    !replaceSubAttributes
  ) {
    alert("変更内容が入力されていません。");
    return;
  }

  const booksToUpdate = getBooks().filter((book) => ids.includes(book.id));
  const attributesValid = booksToUpdate.every((book) => {
    const nextGenre = genre || book.genre;
    const nextSubAttributes = subAttributeIds.length
      ? subAttributeIds
      : book.subAttributeIds || [];
    return (
      Boolean(nextGenre) &&
      nextSubAttributes.length > 0 &&
      isSubAttributeAllowedForMain(nextSubAttributes[0], nextGenre)
    );
  });
  if (!attributesValid) {
    alert("選択した書籍すべてに主属性と副属性が必要です。副属性を指定してください。");
    return;
  }

  const changes = {};
  if (author) changes.author = author;
  if (publisher) changes.publisher = publisher;
  if (genre) changes.genre = genre;
  if (rental) changes.rental = rental;
  if (stockStr !== "") changes.stock = parseInt(stockStr) || 0;
  if (memo) changes.memo = memo;
  if (locVal !== "") changes.location_id = parseInt(locVal) || null;
  if (replaceSubAttributes) {
    changes.subAttributeIds = subAttributeIds;
  }

  try {
    await Promise.all(ids.map((id) => sbUpdateBook(id, changes)));
    closeBulkEditModal();
    renderSearchTable();
    showToast("まとめて編集を適用しました");
  } catch (err) {
    alert("更新に失敗しました。");
    console.error(err);
  }
}

/* ============================================================
   貸出登録タブ
   ============================================================ */
function refreshLoanTab() {
  const userSel = document.getElementById("loan-user-sel");
  const prevUser = userSel.value;
  userSel.innerHTML =
    '<option value="">利用者を選択</option>' +
    getUsers()
      .map(
        (u) =>
          `<option value="${u.id}"${u.id == prevUser ? " selected" : ""}>${escHtml(u.name)}${u.kana ? " (" + escHtml(u.kana) + ")" : ""}</option>`,
      )
      .join("");

  const bookSel = document.getElementById("loan-book-sel");
  const prevBooks = Array.from(bookSel.selectedOptions).map((o) => o.value);
  bookSel.innerHTML = getBooks()
    .filter((b) => b.rental === "○" && b.stock > 0)
    .map(
      (b) =>
        `<option value="${b.id}"${prevBooks.includes(String(b.id)) ? " selected" : ""}>${escHtml(b.title)}（在庫:${b.stock}）</option>`,
    )
    .join("");

  const returnSel = document.getElementById("return-sel");
  const prevReturn = Array.from(returnSel.selectedOptions).map((o) => o.value);
  const activeLoans = getLoans().filter((l) => !l.returnedAt);
  const books = getBooks();
  const users = getUsers();
  returnSel.innerHTML = activeLoans
    .map((l) => {
      const book = books.find((b) => b.id === l.bookId);
      const user = users.find((u) => u.id === l.userId);
      return `<option value="${l.id}"${prevReturn.includes(String(l.id)) ? " selected" : ""}>
      ${escHtml(book ? book.title : "不明")} ／ ${escHtml(user ? user.name : "不明")} （${fmtDate(l.loanDate)}）
    </option>`;
    })
    .join("");

  renderLoanTable();
  renderRequestList();
  renderUserTable();
}

function initLoanTab() {
  document
    .getElementById("btn-loan-exec")
    .addEventListener("click", async () => {
      const userId = parseInt(document.getElementById("loan-user-sel").value);
      const bookSel = document.getElementById("loan-book-sel");
      const due = document.getElementById("loan-due").value;

      if (!userId) {
        setResultMsg("loan-msg", "利用者を選択してください。", "error");
        return;
      }
      const selBookIds = Array.from(bookSel.selectedOptions)
        .map((o) => parseInt(o.value))
        .filter((v) => !Number.isNaN(v));
      if (!selBookIds.length) {
        setResultMsg("loan-msg", "書籍を選択してください。", "error");
        return;
      }

      let successCount = 0;
      for (const bookId of selBookIds) {
        const book = getBooks().find((b) => b.id === bookId);
        if (!book || book.stock <= 0) continue;
        try {
          await sbAddLoan({
            userId,
            bookId,
            loanDate: new Date().toISOString(),
            dueDate: due ? new Date(due).toISOString() : null,
          });
          await sbUpdateBook(bookId, { stock: book.stock - 1 });
          successCount++;
        } catch (err) {
          console.error(err);
        }
      }

      if (!successCount) {
        setResultMsg("loan-msg", "在庫がない書籍が含まれています。", "error");
        return;
      }
      setResultMsg(
        "loan-msg",
        `貸出処理が完了しました。（${successCount}件）`,
        "success",
      );
      showToast(`貸出処理が完了しました（${successCount}件）`);
      document.getElementById("loan-user-sel").value = "";
      Array.from(bookSel.options).forEach((o) => (o.selected = false));
      document.getElementById("loan-due").value = "";
      refreshLoanTab();
    });

  document
    .getElementById("btn-return-exec")
    .addEventListener("click", async () => {
      const returnSel = document.getElementById("return-sel");
      const loanIds = Array.from(returnSel.selectedOptions)
        .map((o) => parseInt(o.value))
        .filter((v) => !Number.isNaN(v));
      if (!loanIds.length) {
        setResultMsg("return-msg", "返却する貸出を選択してください。", "error");
        return;
      }

      let count = 0;
      for (const loanId of loanIds) {
        const loan = getLoans().find((l) => l.id === loanId);
        if (!loan || loan.returnedAt) continue;
        try {
          await sbReturnLoan(loanId);
          const book = getBooks().find((b) => b.id === loan.bookId);
          if (book) await sbUpdateBook(loan.bookId, { stock: book.stock + 1 });
          count++;
        } catch (err) {
          console.error(err);
        }
      }

      setResultMsg(
        "return-msg",
        `返却処理が完了しました。（${count}件）`,
        "success",
      );
      showToast(`返却処理が完了しました（${count}件）`);
      refreshLoanTab();
    });
}

function renderLoanTable() {
  const loans = getLoans();
  const books = getBooks();
  const users = getUsers();
  const tbody = document.getElementById("loan-tbody");

  if (!loans.length) {
    tbody.innerHTML =
      '<tr class="empty-row"><td colspan="6">貸出記録がありません。</td></tr>';
    return;
  }

  tbody.innerHTML = [...loans]
    .sort((a, b) => b.id - a.id)
    .map((l) => {
      const book = books.find((b) => b.id === l.bookId);
      const user = users.find((u) => u.id === l.userId);
      const over = isOverdue(l);
      const badgeClass = l.returnedAt
        ? "badge-returned"
        : over
          ? "badge-overdue"
          : "badge-lending";
      const badgeText = l.returnedAt ? "返却済" : over ? "延滞中" : "貸出中";
      // 返却済みの行をグレー化
      const rowClass = l.returnedAt ? "loan-returned" : "";
      return `<tr class="${rowClass}">
      <td class="loan-user-cell" data-label="利用者">${escHtml(user ? user.name : "—")}</td>
      <td class="loan-book-cell" data-label="書籍">${escHtml(book ? book.title : "—")}</td>
      <td class="loan-date-cell" data-label="貸出日">${fmtDate(l.loanDate)}</td>
      <td class="loan-due-cell" data-label="返却予定日">${fmtDate(l.dueDate)}</td>
      <td class="loan-status-cell" data-label="状態"><span class="badge ${badgeClass}">${badgeText}</span></td>
      <td class="loan-returned-cell" data-label="返却日">${fmtDate(l.returnedAt)}</td>
    </tr>`;
    })
    .join("");
}

/* ============================================================
   書籍検索タブ内 貸出パネル
   ============================================================ */
function openLoanPanel() {
  const ids = getSelectedSearchIds();
  if (!ids.length) {
    alert("貸出する書籍を選択してください。");
    return;
  }
  const books = getBooks();
  const avail = ids.filter((id) => {
    const b = books.find((b) => b.id === id);
    return b && b.rental === "○" && b.stock > 0;
  });
  if (!avail.length) {
    alert("選択した書籍に貸出可能なものがありません（在庫なし・貸出不可）。");
    return;
  }

  // 書籍リストを表示
  const ul = document.getElementById("loan-panel-books");
  ul.innerHTML = avail
    .map((id) => {
      const b = books.find((b) => b.id === id);
      return `<li style="font-size:.85rem;padding:.25rem 0;border-bottom:1px solid var(--border);">
      ${escHtml(b.title)} <span style="color:var(--muted);font-size:.78rem;">（在庫:${b.stock}）</span>
    </li>`;
    })
    .join("");
  document.getElementById("loan-panel-count").textContent = avail.length;

  // 利用者選択肢を設定
  const userSel = document.getElementById("loan-panel-user");
  userSel.innerHTML =
    '<option value="">利用者を選択</option>' +
    getUsers()
      .map(
        (u) =>
          `<option value="${u.id}">${escHtml(u.name)}${u.kana ? " (" + escHtml(u.kana) + ")" : ""}</option>`,
      )
      .join("");
  document.getElementById("loan-panel-due").value = "";
  document.getElementById("loan-panel-msg").textContent = "";
  document.getElementById("loan-panel-msg").className = "result-msg";

  // 対象IDを data に保存
  document.getElementById("modal-loan-panel").dataset.bookIds =
    JSON.stringify(avail);
  document.getElementById("modal-loan-panel").hidden = false;
}

function closeLoanPanel() {
  document.getElementById("modal-loan-panel").hidden = true;
}

async function execLoanPanel() {
  const userId = parseInt(document.getElementById("loan-panel-user").value);
  const due = document.getElementById("loan-panel-due").value;
  const msgEl = document.getElementById("loan-panel-msg");

  if (!userId) {
    setResultMsg("loan-panel-msg", "利用者を選択してください。", "error");
    return;
  }

  const bookIds = JSON.parse(
    document.getElementById("modal-loan-panel").dataset.bookIds || "[]",
  );
  if (!bookIds.length) {
    setResultMsg("loan-panel-msg", "対象書籍がありません。", "error");
    return;
  }

  const btn = document.getElementById("btn-loan-panel-exec");
  btn.disabled = true;
  let successCount = 0;
  for (const bookId of bookIds) {
    const book = getBooks().find((b) => b.id === bookId);
    if (!book || book.stock <= 0) continue;
    try {
      await sbAddLoan({
        userId,
        bookId,
        loanDate: new Date().toISOString(),
        dueDate: due ? new Date(due).toISOString() : null,
      });
      await sbUpdateBook(bookId, { stock: book.stock - 1 });
      successCount++;
    } catch (err) {
      console.error(err);
    }
  }
  btn.disabled = false;

  if (!successCount) {
    setResultMsg(
      "loan-panel-msg",
      "在庫がある書籍がありませんでした。",
      "error",
    );
    return;
  }
  setResultMsg("loan-panel-msg", `貸出完了（${successCount}件）`, "success");
  showToast(`貸出処理が完了しました（${successCount}件）`);
  setTimeout(() => {
    closeLoanPanel();
    refreshLoanTab();
  }, 900);
}

/* ============================================================
   書籍検索タブ内 返却パネル
   ============================================================ */
function openReturnPanel() {
  const ids = getSelectedSearchIds();
  const loans = getLoans();
  const books = getBooks();
  const users = getUsers();

  // 選択書籍の貸出中レコードを取得（選択なしの場合は全貸出中）
  let activeLoans;
  if (ids.length) {
    activeLoans = loans.filter((l) => !l.returnedAt && ids.includes(l.bookId));
    if (!activeLoans.length) {
      alert("選択した書籍に貸出中のものがありません。");
      return;
    }
  } else {
    activeLoans = loans.filter((l) => !l.returnedAt);
    if (!activeLoans.length) {
      alert("現在貸出中の書籍がありません。");
      return;
    }
  }

  const tbody = document.getElementById("return-panel-tbody");
  tbody.innerHTML = activeLoans
    .map((l) => {
      const book = books.find((b) => b.id === l.bookId);
      const user = users.find((u) => u.id === l.userId);
      const over = isOverdue(l);
      return `<tr>
      <td style="text-align:center;"><input type="checkbox" class="return-panel-cb" data-loan-id="${l.id}" checked /></td>
      <td style="font-size:.84rem;">${escHtml(book ? book.title : "—")}</td>
      <td style="font-size:.84rem;">${escHtml(user ? user.name : "—")}</td>
      <td style="font-size:.84rem;${over ? "color:var(--danger);font-weight:600;" : ""}">${fmtDate(l.dueDate)}</td>
    </tr>`;
    })
    .join("");

  document.getElementById("return-panel-select-all").checked = true;
  document.getElementById("return-panel-msg").textContent = "";
  document.getElementById("return-panel-msg").className = "result-msg";
  document.getElementById("modal-return-panel").hidden = false;
}

function closeReturnPanel() {
  document.getElementById("modal-return-panel").hidden = true;
}

async function execReturnPanel() {
  const checked = document.querySelectorAll(".return-panel-cb:checked");
  const loanIds = Array.from(checked).map((cb) => parseInt(cb.dataset.loanId));
  if (!loanIds.length) {
    setResultMsg(
      "return-panel-msg",
      "返却する貸出を選択してください。",
      "error",
    );
    return;
  }

  const btn = document.getElementById("btn-return-panel-exec");
  btn.disabled = true;
  let count = 0;
  for (const loanId of loanIds) {
    const loan = getLoans().find((l) => l.id === loanId);
    if (!loan || loan.returnedAt) continue;
    try {
      await sbReturnLoan(loanId);
      const book = getBooks().find((b) => b.id === loan.bookId);
      if (book) await sbUpdateBook(loan.bookId, { stock: book.stock + 1 });
      count++;
    } catch (err) {
      console.error(err);
    }
  }
  btn.disabled = false;

  setResultMsg("return-panel-msg", `返却完了（${count}件）`, "success");
  showToast(`返却処理が完了しました（${count}件）`);
  setTimeout(() => {
    closeReturnPanel();
    refreshLoanTab();
  }, 900);
}

function renderRequestList() {
  const tbody = document.getElementById("request-list-tbody");
  if (!tbody) return;
  const pending = getRequests()
    .filter((r) => r.status === "pending")
    .sort((a, b) => b.id - a.id);
  const books = getBooks();

  if (!pending.length) {
    tbody.innerHTML =
      '<tr class="empty-row"><td colspan="6">現在、未対応の依頼はありません。</td></tr>';
    return;
  }

  tbody.innerHTML = pending
    .map((r) => {
      const book = books.find((b) => b.id === r.bookId);
      return `<tr>
      <td class="request-book-cell" data-label="書籍">${escHtml(book ? book.title : "—")}</td>
      <td class="requester-cell" data-label="依頼者">${escHtml(r.requesterName || "（匿名）")}</td>
      <td class="request-contact-cell" data-label="連絡先">${escHtml(r.requesterContact || "—")}</td>
      <td class="request-message-cell" data-label="メッセージ">${escHtml(r.message || "—")}</td>
      <td class="request-date-cell" data-label="受付日時">${fmtDate(r.createdAt)}</td>
      <td class="request-action-cell" data-label="操作">
        <button class="btn btn-sm btn-ghost" onclick="handleRequest(${r.id})">対応済みにする</button>
      </td>
    </tr>`;
    })
    .join("");
}

async function handleRequest(id) {
  try {
    const { error } = await client
      .from("loan_requests")
      .update({ status: "handled" })
      .eq("id", id);
    if (error) throw error;
    const idx = _cache.requests.findIndex((r) => r.id === id);
    if (idx !== -1) _cache.requests[idx].status = "handled";
    renderRequestList();
    showToast("対応済みにしました");
  } catch (err) {
    showToast("更新に失敗しました", "error");
    console.error(err);
  }
}
window.handleRequest = handleRequest;

/* ============================================================
   利用者管理タブ
   ============================================================ */
function initUserTab() {
  document
    .getElementById("btn-user-save")
    .addEventListener("click", async () => {
      const name = document.getElementById("user-name").value.trim();
      const kana = document.getElementById("user-kana").value.trim();
      const contact = document.getElementById("user-contact").value.trim();
      const memo = document.getElementById("user-memo").value.trim();
      if (!name) {
        setResultMsg("user-result-msg", "氏名は必須です。", "error");
        return;
      }
      try {
        const saved = await sbAddUser({ name, kana, contact, memo });
        setResultMsg(
          "user-result-msg",
          `「${saved.name}」を登録しました。`,
          "success",
        );
        showToast("利用者を登録しました");
        clearUserForm();
        renderUserTable();
      } catch (err) {
        setResultMsg("user-result-msg", "登録に失敗しました。", "error");
        console.error(err);
      }
    });
  document
    .getElementById("btn-user-clear")
    .addEventListener("click", clearUserForm);
}

function clearUserForm() {
  ["user-name", "user-kana", "user-contact", "user-memo"].forEach((id) => {
    document.getElementById(id).value = "";
  });
}

function renderUserTable() {
  const users = getUsers();
  const tbody = document.getElementById("user-tbody");
  if (!users.length) {
    tbody.innerHTML =
      '<tr class="empty-row"><td colspan="5">利用者が登録されていません。</td></tr>';
    return;
  }
  tbody.innerHTML = users
    .map(
      (u) => `
    <tr>
      <td><strong>${escHtml(u.name)}</strong></td>
      <td>${escHtml(u.kana || "—")}</td>
      <td>${escHtml(u.contact || "—")}</td>
      <td>${escHtml(u.memo || "—")}</td>
      <td>
        <div class="action-cell">
          <button class="btn btn-icon danger" title="削除" onclick="deleteUser(${u.id})">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
          </button>
        </div>
      </td>
    </tr>
  `,
    )
    .join("");
}

async function deleteUser(id) {
  const user = getUsers().find((u) => u.id === id);
  if (!user) return;
  if (!confirm(`「${user.name}」を削除してもよろしいですか？`)) return;
  try {
    await sbDeleteUser(id);
    renderUserTable();
    showToast("利用者を削除しました", "info");
  } catch (err) {
    alert("削除に失敗しました。");
    console.error(err);
  }
}
window.deleteUser = deleteUser;

/* ============================================================
   統計タブ
   ============================================================ */
let genreChartInstance = null;

function renderStats() {
  const books = getBooks();
  const users = getUsers();
  const loans = getLoans();
  const active = loans.filter((l) => !l.returnedAt);
  const overdue = active.filter(isOverdue);
  // 仮登録（在庫0・貸出なし＝配達待ち）はまだ実際に所蔵していないため統計から除外する
  const statsBooks = books.filter((b) => !isProvisionalBook(b) && !isPurchasePlannedBook(b));
  const totalStock = statsBooks.reduce((s, b) => s + (b.stock || 0), 0);

  document.getElementById("stat-books").textContent = statsBooks.length;
  document.getElementById("stat-users").textContent = users.length;
  document.getElementById("stat-loans").textContent = active.length;
  document.getElementById("stat-stock").textContent = totalStock;
  document.getElementById("stat-overdue").textContent = overdue.length
    ? `延滞 ${overdue.length}件`
    : "延滞なし";
  document.getElementById("stat-time").textContent = new Date().toLocaleString(
    "ja-JP",
  );
  document.getElementById("stat-ua").textContent = navigator.userAgent || "";
  const locEl = document.getElementById("stat-locations");
  if (locEl) locEl.textContent = _cache.locations.length;
  renderGenreCount();

  const genreMap = {};
  statsBooks.forEach((b) => {
    const g = b.genre || "未設定";
    genreMap[g] = (genreMap[g] || 0) + 1;
  });
  const labels = Object.keys(genreMap);
  const values = Object.values(genreMap);
  const COLORS = [
    "#2d6b52",
    "#3d8a6e",
    "#c4913b",
    "#c0392b",
    "#7a4fa0",
    "#2e6da4",
    "#6aab5e",
    "#d4793a",
    "#8e44ad",
    "#16a085",
    "#f39c12",
  ];

  const canvas = document.getElementById("stats-genre-canvas");
  const emptyMsg = document.getElementById("stats-genre-empty");
  if (genreChartInstance) {
    genreChartInstance.destroy();
    genreChartInstance = null;
  }

  if (!labels.length) {
    canvas.style.display = "none";
    emptyMsg.style.display = "block";
    return;
  }
  canvas.style.display = "block";
  emptyMsg.style.display = "none";

  genreChartInstance = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: labels.map((_, index) => COLORS[index % COLORS.length]),
          borderWidth: 1,
          borderColor: labels.map((_, index) => COLORS[index % COLORS.length]),
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (ctx) => ` ${ctx.label}: ${ctx.raw}冊` },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0 },
        },
      },
    },
  });
}

function renderGenreCount() {
  const genreEl = document.getElementById("stat-genres");
  if (genreEl) genreEl.textContent = getMainAttributes().length;
}

/* ============================================================
   認証
   ============================================================ */
let _realtimeSetup = false;

async function onSignedIn(session) {
  try {
    await loadAllData();
  } catch (error) {
    console.error("データ読み込みに失敗しました", error);
    document.getElementById("login-error").textContent =
      `データの読み込みに失敗しました。SQLを実行済みか確認してください: ${error.message}`;
    document.getElementById("login-overlay").removeAttribute("hidden");
    document.getElementById("header-user").setAttribute("hidden", "");
    return;
  }

  document.getElementById("header-user").removeAttribute("hidden");
  document.getElementById("login-overlay").setAttribute("hidden", "");

  if (!_realtimeSetup) {
    setupRealtime();
    _realtimeSetup = true;
  }

  // 位置選択肢を全フォームに初期反映
  updateAllLocationSelects();
  refreshAttributeSelects();

  renderBulkTable();
  renderSearchTable();
  renderAttributeManagement();
  renderUserTable();
  refreshLoanTab();
  initLocationTab();
}

function onSignedOut() {
  _cache = {
    books: [],
    users: [],
    loans: [],
    locations: [],
    requests: [],
    attributes: [],
    bookAttributes: [],
  };
  _realtimeSetup = false;
  selectedBookIds.clear();
  document.getElementById("header-user").setAttribute("hidden", "");
  document.getElementById("login-overlay").removeAttribute("hidden");
  document.getElementById("login-email").value = "";
  document.getElementById("login-password").value = "";
  document.getElementById("login-error").textContent = "";
  renderSearchTable();
  renderUserTable();
  refreshLoanTab();
}

function setupLoginHandlers() {
  const btnLogin = document.getElementById("btn-login");

  btnLogin.addEventListener("click", async () => {
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const errEl = document.getElementById("login-error");
    errEl.textContent = "";

    if (!email || !password) {
      errEl.textContent = "メールアドレスとパスワードを入力してください。";
      return;
    }

    btnLogin.disabled = true;
    btnLogin.textContent = "ログイン中...";

    const { error } = await client.auth.signInWithPassword({ email, password });

    btnLogin.disabled = false;
    btnLogin.textContent = "ログイン";
    if (error) errEl.textContent = error.message || "ログインに失敗しました。";
  });

  document.getElementById("login-email").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("login-password").focus();
  });
  document.getElementById("login-password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") btnLogin.click();
  });
  document.getElementById("btn-logout").addEventListener("click", async () => {
    if (confirm("ログアウトしますか？")) await client.auth.signOut();
  });
}

/* ============================================================
   初期化
   ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  setupLoginHandlers();

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      showTab(btn.dataset.tab);
      document.getElementById("global-nav").classList.remove("open");
    });
  });

  document.getElementById("nav-toggle").addEventListener("click", () => {
    document.getElementById("global-nav").classList.toggle("open");
  });

  initRegisterTab();
  initBulkTab();
  initSearchTab();
  initAttributeTab();
  initLoanTab();
  initUserTab();

  client.auth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_IN") await onSignedIn(session);
    if (event === "SIGNED_OUT") onSignedOut();
  });

  const {
    data: { session },
  } = await client.auth.getSession();
  if (session) await onSignedIn(session);
});