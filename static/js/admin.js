const KIND_OPTIONS = [
  ["apk", "Game APK"],
  ["data", "Game data (OBB or ZIP)"],
  ["other", "Extra file"],
];
const FILE_ACCEPT = ".apk,.xapk,.apks,.obb,.zip,.7z,.rar";

let entryCounter = 0;

function newEntry(kind) {
  entryCounter += 1;
  return { key: entryCounter, kind: kind || "apk", label: "", mode: "upload", file: null, url: "" };
}

function AdminBar(props) {
  return h(
    "header",
    { className: "site-header" },
    h(
      "div",
      { className: "container d-flex align-items-center justify-content-between" },
      h("a", { className: "brand", href: "/" }, h("span", { className: "brand-mark", "aria-hidden": "true" }), "Loadout admin"),
      h(
        "div",
        { className: "d-flex align-items-center gap-3" },
        h("a", { className: "header-link", href: "/" }, "View site"),
        props.onSignOut
          ? h("button", { type: "button", className: "btn btn-outline-ink btn-sm", onClick: props.onSignOut }, "Sign out")
          : null
      )
    )
  );
}

function LoginForm(props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.postJson("/api/admin/login", { password: password });
      props.onSuccess();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return h(
    "div",
    { className: "row justify-content-center" },
    h(
      "div",
      { className: "col-md-8 col-lg-5" },
      h(
        "form",
        { className: "admin-card", onSubmit: submit },
        h("h1", { className: "admin-title" }, "Sign in"),
        h("label", { htmlFor: "admin-password", className: "form-label" }, "Admin password"),
        h("input", {
          id: "admin-password",
          type: "password",
          className: "form-control mb-3",
          autoComplete: "current-password",
          value: password,
          required: true,
          onChange: (event) => setPassword(event.target.value),
        }),
        error ? h("p", { className: "error-text", role: "alert" }, error) : null,
        h("button", { type: "submit", className: "btn btn-primary w-100", disabled: busy }, busy ? "Signing in" : "Sign in")
      )
    )
  );
}

function EntryRow(props) {
  const entry = props.entry;
  const change = (patch) => props.onChange(entry.key, patch);
  const idBase = "entry-" + entry.key;

  return h(
    "div",
    { className: "entry-row" },
    h(
      "div",
      { className: "row g-3" },
      h(
        "div",
        { className: "col-md-4" },
        h("label", { htmlFor: idBase + "-kind", className: "form-label" }, "File type"),
        h(
          "select",
          {
            id: idBase + "-kind",
            className: "form-select",
            value: entry.kind,
            onChange: (event) => change({ kind: event.target.value }),
          },
          KIND_OPTIONS.map((option) => h("option", { key: option[0], value: option[0] }, option[1]))
        )
      ),
      h(
        "div",
        { className: "col-md-8" },
        h("label", { htmlFor: idBase + "-label", className: "form-label" }, "Label shown to visitors"),
        h("input", {
          id: idBase + "-label",
          type: "text",
          className: "form-control",
          placeholder: "Example: Main APK or Data pack 1",
          maxLength: 80,
          value: entry.label,
          onChange: (event) => change({ label: event.target.value }),
        })
      ),
      h(
        "div",
        { className: "col-12" },
        h(
          "div",
          { className: "btn-group mb-3", role: "group", "aria-label": "File source" },
          h(
            "button",
            {
              type: "button",
              className: "btn btn-sm " + (entry.mode === "upload" ? "btn-primary" : "btn-outline-ink"),
              onClick: () => change({ mode: "upload" }),
            },
            "Upload a file"
          ),
          h(
            "button",
            {
              type: "button",
              className: "btn btn-sm " + (entry.mode === "link" ? "btn-primary" : "btn-outline-ink"),
              onClick: () => change({ mode: "link" }),
            },
            "Use a download link"
          )
        ),
        entry.mode === "upload"
          ? h("input", {
              type: "file",
              className: "form-control",
              accept: FILE_ACCEPT,
              "aria-label": "Choose a file to upload",
              onChange: (event) => change({ file: event.target.files[0] || null }),
            })
          : h("input", {
              type: "url",
              className: "form-control",
              placeholder: "https://example.com/game.apk",
              "aria-label": "External download link",
              value: entry.url,
              onChange: (event) => change({ url: event.target.value }),
            })
      ),
      props.canRemove
        ? h(
            "div",
            { className: "col-12" },
            h("button", { type: "button", className: "btn btn-outline-ink btn-sm", onClick: () => props.onRemove(entry.key) }, "Remove this file")
          )
        : null
    )
  );
}

function GameForm(props) {
  const editing = props.game;
  const [fields, setFields] = useState({
    title: editing ? editing.title : "",
    category: editing ? editing.category : "",
    version: editing ? editing.version : "",
    package: editing ? editing.package : "",
    description: editing ? editing.description : "",
  });
  const [cover, setCover] = useState(null);
  const [entries, setEntries] = useState(editing ? [] : [newEntry("apk")]);
  const [existing, setExisting] = useState(editing ? editing.files : []);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const setField = (name) => (event) => {
    const value = event.target.value;
    setFields((current) => Object.assign({}, current, { [name]: value }));
  };

  const updateEntry = (key, patch) => {
    setEntries((list) => list.map((entry) => (entry.key === key ? Object.assign({}, entry, patch) : entry)));
  };

  const removeEntry = (key) => {
    setEntries((list) => list.filter((entry) => entry.key !== key));
  };

  const removeExisting = async (file) => {
    if (!window.confirm('Remove "' + file.label + '" from this game?')) {
      return;
    }
    try {
      await api.remove("/api/admin/files/" + file.id);
      setExisting((list) => list.filter((item) => item.id !== file.id));
    } catch (err) {
      if (err.status === 401) {
        props.onUnauthorized();
      } else {
        setError(err.message);
      }
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    const active = entries.filter(
      (entry) => (entry.mode === "upload" && entry.file) || (entry.mode === "link" && entry.url.trim())
    );
    if (!fields.title.trim()) {
      setError("Enter a game title.");
      return;
    }
    if (!editing && active.length === 0) {
      setError("Add at least one file or download link.");
      return;
    }
    const form = new FormData();
    form.append("title", fields.title);
    form.append("category", fields.category);
    form.append("version", fields.version);
    form.append("package", fields.package);
    form.append("description", fields.description);
    if (cover) {
      form.append("cover", cover);
    }
    form.append("entry_count", String(active.length));
    active.forEach((entry, index) => {
      form.append("kind_" + index, entry.kind);
      form.append("label_" + index, entry.label);
      if (entry.mode === "upload") {
        form.append("file_" + index, entry.file);
      } else {
        form.append("url_" + index, entry.url.trim());
      }
    });
    setBusy(true);
    setProgress(0);
    try {
      await api.upload(
        editing ? "/api/admin/games/" + editing.id : "/api/admin/games",
        editing ? "PUT" : "POST",
        form,
        setProgress
      );
      props.onSaved();
    } catch (err) {
      if (err.status === 401) {
        props.onUnauthorized();
        return;
      }
      setError(err.message);
      setBusy(false);
      setProgress(null);
    }
  };

  return h(
    "form",
    { className: "admin-card", onSubmit: submit },
    h("h1", { className: "admin-title" }, editing ? "Edit " + editing.title : "Add a game"),
    h(
      "div",
      { className: "row g-3" },
      h(
        "div",
        { className: "col-md-6" },
        h("label", { htmlFor: "game-title", className: "form-label" }, "Title"),
        h("input", { id: "game-title", type: "text", className: "form-control", maxLength: 120, value: fields.title, onChange: setField("title"), required: true })
      ),
      h(
        "div",
        { className: "col-md-6" },
        h("label", { htmlFor: "game-category", className: "form-label" }, "Category"),
        h("input", { id: "game-category", type: "text", className: "form-control", maxLength: 40, placeholder: "Action, Racing, Puzzle", value: fields.category, onChange: setField("category") })
      ),
      h(
        "div",
        { className: "col-md-6" },
        h("label", { htmlFor: "game-version", className: "form-label" }, "Version"),
        h("input", { id: "game-version", type: "text", className: "form-control", maxLength: 40, placeholder: "1.4.2", value: fields.version, onChange: setField("version") })
      ),
      h(
        "div",
        { className: "col-md-6" },
        h("label", { htmlFor: "game-package", className: "form-label" }, "Package name"),
        h("input", { id: "game-package", type: "text", className: "form-control", maxLength: 150, placeholder: "com.studio.game", value: fields.package, onChange: setField("package") }),
        h("div", { className: "field-hint mt-1" }, "Needed to show the correct data folder for games with OBB files.")
      ),
      h(
        "div",
        { className: "col-12" },
        h("label", { htmlFor: "game-description", className: "form-label" }, "Description"),
        h("textarea", { id: "game-description", className: "form-control", rows: 4, maxLength: 4000, value: fields.description, onChange: setField("description") })
      ),
      h(
        "div",
        { className: "col-12" },
        h("label", { htmlFor: "game-cover", className: "form-label" }, editing ? "Replace cover image" : "Cover image"),
        h("input", {
          id: "game-cover",
          type: "file",
          className: "form-control",
          accept: ".png,.jpg,.jpeg,.webp",
          onChange: (event) => setCover(event.target.files[0] || null),
        }),
        h("div", { className: "field-hint mt-1" }, "Optional. A colored tile with the game's initials is used when there is no cover.")
      )
    ),
    existing.length > 0
      ? h(
          "div",
          null,
          h("h2", { className: "section-title" }, "Current files"),
          h(
            "ul",
            { className: "file-list" },
            existing.map((file) =>
              h(
                "li",
                { className: "file-row", key: file.id },
                h(
                  "div",
                  { className: "file-info" },
                  h("span", { className: "file-kind kind-" + file.kind }, KIND_OPTIONS.find((option) => option[0] === file.kind)[1]),
                  h("span", { className: "file-label" }, file.label),
                  h("span", { className: "file-size" }, file.external ? "Hosted externally" : formatSize(file.size))
                ),
                h("button", { type: "button", className: "btn btn-outline-ink btn-sm", onClick: () => removeExisting(file) }, "Remove")
              )
            )
          )
        )
      : null,
    h("h2", { className: "section-title" }, editing ? "Add more files" : "Files"),
    h(
      "div",
      { className: "d-grid gap-3 mb-3" },
      entries.map((entry) =>
        h(EntryRow, {
          key: entry.key,
          entry: entry,
          canRemove: editing ? true : entries.length > 1,
          onChange: updateEntry,
          onRemove: removeEntry,
        })
      )
    ),
    h(
      "div",
      { className: "d-flex flex-wrap gap-2 mb-4" },
      h("button", { type: "button", className: "btn btn-outline-ink btn-sm", onClick: () => setEntries((list) => list.concat([newEntry("apk")])) }, "Add another APK"),
      h("button", { type: "button", className: "btn btn-outline-ink btn-sm", onClick: () => setEntries((list) => list.concat([newEntry("data")])) }, "Add a data file")
    ),
    progress !== null
      ? h(
          "div",
          { className: "progress mb-3", role: "progressbar", "aria-label": "Upload progress", "aria-valuenow": progress, "aria-valuemin": 0, "aria-valuemax": 100 },
          h("div", { className: "progress-bar", style: { width: progress + "%", background: "var(--violet)" } }, progress + "%")
        )
      : null,
    error ? h("p", { className: "error-text", role: "alert" }, error) : null,
    h(
      "div",
      { className: "d-flex flex-wrap gap-2" },
      h("button", { type: "submit", className: "btn btn-primary", disabled: busy }, busy ? "Uploading" : editing ? "Save changes" : "Publish game"),
      h("button", { type: "button", className: "btn btn-outline-ink", onClick: props.onCancel, disabled: busy }, "Cancel")
    )
  );
}

function Dashboard(props) {
  const [games, setGames] = useState(null);
  const [view, setView] = useState({ name: "list", game: null });
  const [error, setError] = useState("");

  const load = () => {
    api
      .get("/api/games?sort=newest")
      .then(setGames)
      .catch((err) => setError(err.message));
  };

  useEffect(load, []);

  const remove = async (game) => {
    if (!window.confirm('Delete "' + game.title + '" and all of its files? This cannot be undone.')) {
      return;
    }
    try {
      await api.remove("/api/admin/games/" + game.id);
      load();
    } catch (err) {
      if (err.status === 401) {
        props.onUnauthorized();
      } else {
        setError(err.message);
      }
    }
  };

  if (view.name === "form") {
    return h(GameForm, {
      key: view.game ? view.game.id : "new",
      game: view.game,
      onSaved: () => {
        setView({ name: "list", game: null });
        load();
      },
      onCancel: () => setView({ name: "list", game: null }),
      onUnauthorized: props.onUnauthorized,
    });
  }

  let table;
  if (games === null) {
    table = h(
      "div",
      { className: "state-box" },
      h("div", { className: "spinner-border text-primary", role: "status" }, h("span", { className: "visually-hidden" }, "Loading games"))
    );
  } else if (games.length === 0) {
    table = h("div", { className: "state-box" }, h("h3", null, "No games yet"), h("p", null, "Use Add a game to publish the first one."));
  } else {
    table = h(
      "div",
      { className: "table-responsive" },
      h(
        "table",
        { className: "table admin-table align-middle" },
        h(
          "thead",
          null,
          h("tr", null, h("th", null, "Game"), h("th", null, "Category"), h("th", null, "Files"), h("th", null, "Downloads"), h("th", { className: "text-end" }, "Actions"))
        ),
        h(
          "tbody",
          null,
          games.map((game) =>
            h(
              "tr",
              { key: game.id },
              h(
                "td",
                null,
                h(
                  "div",
                  { className: "d-flex align-items-center gap-3" },
                  h(Cover, { game: game, className: "admin-thumb" }),
                  h("div", null, h("div", { className: "fw-bold" }, game.title), h("div", { className: "field-hint" }, game.version ? "v" + game.version : "No version"))
                )
              ),
              h("td", null, game.category),
              h("td", null, game.files.length + " (" + formatSize(game.total_size) + ")"),
              h("td", null, game.downloads.toLocaleString()),
              h(
                "td",
                { className: "text-end" },
                h("button", { type: "button", className: "btn btn-outline-ink btn-sm me-2", onClick: () => setView({ name: "form", game: game }) }, "Edit"),
                h("button", { type: "button", className: "btn btn-outline-ink btn-sm", onClick: () => remove(game) }, "Delete")
              )
            )
          )
        )
      )
    );
  }

  return h(
    "div",
    { className: "admin-card" },
    h(
      "div",
      { className: "admin-bar" },
      h("h1", { className: "admin-title mb-0" }, "Games"),
      h("button", { type: "button", className: "btn btn-primary", onClick: () => setView({ name: "form", game: null }) }, "Add a game")
    ),
    error ? h("p", { className: "error-text", role: "alert" }, error) : null,
    table
  );
}

function AdminApp() {
  const [state, setState] = useState("checking");

  useEffect(() => {
    api
      .get("/api/admin/session")
      .then((data) => setState(data.signed_in ? "in" : "out"))
      .catch(() => setState("out"));
  }, []);

  const signOut = async () => {
    try {
      await api.postJson("/api/admin/logout", {});
    } finally {
      setState("out");
    }
  };

  let content;
  if (state === "checking") {
    content = h(
      "div",
      { className: "state-box" },
      h("div", { className: "spinner-border text-primary", role: "status" }, h("span", { className: "visually-hidden" }, "Checking session"))
    );
  } else if (state === "out") {
    content = h(LoginForm, { onSuccess: () => setState("in") });
  } else {
    content = h(Dashboard, { onUnauthorized: () => setState("out") });
  }

  return h(
    React.Fragment,
    null,
    h(AdminBar, { onSignOut: state === "in" ? signOut : null }),
    h("main", { className: "admin-shell" }, h("div", { className: "container" }, content))
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(h(AdminApp));
