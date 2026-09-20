const CATEGORY_ALL = "All";
const KIND_LABELS = { apk: "Game APK", data: "Game data", other: "Extra file" };
const KIND_ACTIONS = { apk: "Download APK", data: "Download data", other: "Download file" };
const SORT_OPTIONS = [
  ["newest", "Newest first"],
  ["popular", "Most downloaded"],
];

function useDebounced(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function Header() {
  return h(
    "header",
    { className: "site-header" },
    h(
      "div",
      { className: "container d-flex align-items-center justify-content-between" },
      h("a", { className: "brand", href: "/" }, h("span", { className: "brand-mark", "aria-hidden": "true" }), "Loadout"),
      h("a", { className: "header-link", href: "#library" }, "Browse games")
    )
  );
}

function Hero(props) {
  const placeholders = [{ title: "Loadout" }, { title: "Free games" }, { title: "Android" }];
  const stack = props.featured.concat(placeholders).slice(0, 3);
  const onSubmit = (event) => {
    event.preventDefault();
    const target = document.getElementById("library");
    if (target) {
      target.scrollIntoView({ behavior: "smooth" });
    }
  };
  return h(
    "section",
    { className: "hero" },
    h(
      "div",
      { className: "container" },
      h(
        "div",
        { className: "hero-panel" },
        h(
          "div",
          { className: "row align-items-center g-5" },
          h(
            "div",
            { className: "col-lg-7" },
            h("h1", { className: "hero-title" }, "Pick a game. Tap download."),
            h(
              "p",
              { className: "hero-lead" },
              "Free Android games with every file they need, in one place. Search the library or browse by category."
            ),
            h(
              "form",
              { className: "hero-search", role: "search", onSubmit: onSubmit },
              h("label", { htmlFor: "search-input", className: "visually-hidden" }, "Search games"),
              h("input", {
                id: "search-input",
                type: "search",
                className: "form-control",
                placeholder: "Search by game name or package",
                autoComplete: "off",
                value: props.query,
                onChange: (event) => props.onQuery(event.target.value),
              }),
              h("button", { type: "submit", className: "btn btn-lime" }, "Search")
            )
          ),
          h(
            "div",
            { className: "col-lg-5 d-none d-lg-block", "aria-hidden": "true" },
            h(
              "div",
              { className: "cover-stack" },
              stack.map((game, index) => h(Cover, { key: index, game: game, className: "stack-" + (index + 1) }))
            )
          )
        )
      )
    )
  );
}

function GameTile(props) {
  const game = props.game;
  return h(
    "article",
    { className: "tile" },
    h(Cover, { game: game }),
    h(
      "h3",
      { className: "tile-title" },
      h("button", { type: "button", className: "tile-open", onClick: () => props.onOpen(game) }, game.title)
    ),
    h(
      "p",
      { className: "tile-meta" },
      h("span", null, game.category),
      game.version ? h("span", null, "v" + game.version) : null
    ),
    h(
      "div",
      { className: "tile-foot" },
      h("span", { className: "tile-size" }, formatSize(game.total_size)),
      h("button", { type: "button", className: "btn btn-primary btn-sm", onClick: () => props.onOpen(game) }, "Download")
    )
  );
}

function DetailModal(props) {
  const game = props.game;
  const onClose = props.onClose;
  const closeRef = useRef(null);

  useEffect(() => {
    document.body.classList.add("modal-open");
    if (closeRef.current) {
      closeRef.current.focus();
    }
    const onKey = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("modal-open");
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const hasData = game.files.some((file) => file.kind === "data");
  const installSteps = hasData
    ? [
        "Download the game APK and every data file listed above.",
        game.package
          ? "Copy the data files into Android/obb/" + game.package + "/ on your phone. Create the folder if it does not exist."
          : "Copy the data files into the Android/obb/ folder, inside a folder named after the game's package name.",
        "Open the APK and install it. Allow installs from your browser or file manager if Android asks.",
        "Launch the game. The first start can take a moment while it loads its data.",
      ]
    : [
        "Download the game APK.",
        "Open the APK and install it. Allow installs from your browser or file manager if Android asks.",
        "Launch the game.",
      ];

  return h(
    React.Fragment,
    null,
    h(
      "div",
      {
        className: "modal fade show d-block detail",
        tabIndex: -1,
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "detail-title",
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) {
            onClose();
          }
        },
      },
      h(
        "div",
        { className: "modal-dialog modal-dialog-centered modal-dialog-scrollable modal-lg" },
        h(
          "div",
          { className: "modal-content" },
          h("button", {
            type: "button",
            className: "btn-close detail-close",
            "aria-label": "Close",
            ref: closeRef,
            onClick: onClose,
          }),
          h(
            "div",
            { className: "modal-body p-4 p-md-5" },
            h(
              "div",
              { className: "row g-4" },
              h("div", { className: "col-md-4" }, h(Cover, { game: game, className: "detail-cover" })),
              h(
                "div",
                { className: "col-md-8" },
                h("h2", { id: "detail-title", className: "detail-title" }, game.title),
                h(
                  "div",
                  { className: "stat-row" },
                  h("span", null, game.category),
                  game.version ? h("span", null, "Version " + game.version) : null,
                  h("span", null, formatSize(game.total_size)),
                  h("span", null, game.downloads.toLocaleString() + " downloads")
                ),
                game.description ? h("p", { className: "detail-description" }, game.description) : null,
                h("h3", { className: "section-title" }, "Files"),
                h(
                  "ul",
                  { className: "file-list" },
                  game.files.map((file) =>
                    h(
                      "li",
                      { className: "file-row", key: file.id },
                      h(
                        "div",
                        { className: "file-info" },
                        h("span", { className: "file-kind kind-" + file.kind }, KIND_LABELS[file.kind]),
                        h("span", { className: "file-label" }, file.label),
                        h("span", { className: "file-size" }, file.external ? "Hosted externally" : formatSize(file.size))
                      ),
                      h(
                        "a",
                        { className: "btn btn-primary btn-sm", href: file.download_url, download: "" },
                        KIND_ACTIONS[file.kind]
                      )
                    )
                  )
                ),
                h("h3", { className: "section-title" }, "How to install"),
                h(
                  "ol",
                  { className: "install-steps" },
                  installSteps.map((step, index) => h("li", { key: index }, step))
                )
              )
            )
          )
        )
      )
    ),
    h("div", { className: "modal-backdrop fade show" })
  );
}

function Library(props) {
  const filtered = props.query.trim() !== "" || props.category !== CATEGORY_ALL;

  let body;
  if (props.status === "loading") {
    body = h(
      "div",
      { className: "state-box" },
      h("div", { className: "spinner-border text-primary", role: "status" }, h("span", { className: "visually-hidden" }, "Loading games"))
    );
  } else if (props.status === "error") {
    body = h(
      "div",
      { className: "state-box" },
      h("h3", null, "The library did not load"),
      h("p", null, props.errorMessage),
      h("button", { type: "button", className: "btn btn-outline-ink", onClick: props.onRetry }, "Try again")
    );
  } else if (props.games.length === 0) {
    body = h(
      "div",
      { className: "state-box" },
      h("h3", null, filtered ? "No games match your search" : "The library is empty"),
      h("p", null, filtered ? "Try a different name or clear the filters to see every game." : "New games will appear here soon."),
      filtered
        ? h("button", { type: "button", className: "btn btn-outline-ink", onClick: props.onClear }, "Clear filters")
        : null
    );
  } else {
    body = h(
      "div",
      { className: "row g-4 row-cols-2 row-cols-md-3 row-cols-xl-4" },
      props.games.map((game) => h("div", { className: "col", key: game.id }, h(GameTile, { game: game, onOpen: props.onOpen })))
    );
  }

  return h(
    "section",
    { className: "library", id: "library" },
    h(
      "div",
      { className: "container" },
      h(
        "div",
        { className: "library-head" },
        h(
          "div",
          null,
          h("h2", { className: "library-title" }, "Game library"),
          props.status === "ready"
            ? h("p", { className: "library-count" }, props.games.length + (props.games.length === 1 ? " game" : " games"))
            : null
        ),
        h(
          "div",
          null,
          h("label", { htmlFor: "sort-select", className: "visually-hidden" }, "Sort games"),
          h(
            "select",
            {
              id: "sort-select",
              className: "form-select sort-select",
              value: props.sort,
              onChange: (event) => props.onSort(event.target.value),
            },
            SORT_OPTIONS.map((option) => h("option", { key: option[0], value: option[0] }, option[1]))
          )
        )
      ),
      h(
        "div",
        { className: "chip-row", role: "group", "aria-label": "Filter by category" },
        [CATEGORY_ALL].concat(props.categories).map((name) =>
          h(
            "button",
            {
              key: name,
              type: "button",
              className: "chip" + (props.category === name ? " is-active" : ""),
              "aria-pressed": props.category === name,
              onClick: () => props.onCategory(name),
            },
            name
          )
        )
      ),
      body
    )
  );
}

function Footer() {
  return h(
    "footer",
    { className: "site-footer" },
    h(
      "div",
      { className: "container" },
      h("p", { className: "mb-1" }, "Scan every APK with your security app before you install it."),
      h("p", { className: "mb-0" }, "Files are hosted as provided. Install only what you trust.")
    )
  );
}

function App() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(CATEGORY_ALL);
  const [sort, setSort] = useState("newest");
  const [games, setGames] = useState([]);
  const [featured, setFeatured] = useState([]);
  const [categories, setCategories] = useState([]);
  const [status, setStatus] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState(null);
  const debouncedQuery = useDebounced(query, 250);

  useEffect(() => {
    api.get("/api/games?sort=popular").then((data) => setFeatured(data.slice(0, 3))).catch(() => setFeatured([]));
    api.get("/api/categories").then(setCategories).catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    const params = new URLSearchParams({ q: debouncedQuery, category: category, sort: sort });
    api
      .get("/api/games?" + params.toString())
      .then((data) => {
        if (!cancelled) {
          setGames(data);
          setStatus("ready");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setErrorMessage(error.message);
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, category, sort, reloadKey]);

  const closeDetail = useCallback(() => setSelected(null), []);
  const clearFilters = () => {
    setQuery("");
    setCategory(CATEGORY_ALL);
  };

  return h(
    React.Fragment,
    null,
    h(Header),
    h("main", null,
      h(Hero, { query: query, onQuery: setQuery, featured: featured }),
      h(Library, {
        games: games,
        categories: categories,
        status: status,
        errorMessage: errorMessage,
        query: query,
        category: category,
        sort: sort,
        onQuery: setQuery,
        onCategory: setCategory,
        onSort: setSort,
        onClear: clearFilters,
        onRetry: () => setReloadKey((value) => value + 1),
        onOpen: setSelected,
      })
    ),
    h(Footer),
    selected ? h(DetailModal, { game: selected, onClose: closeDetail }) : null
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(h(App));
