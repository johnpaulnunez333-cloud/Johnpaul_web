const h = React.createElement;
const { useState, useEffect, useRef, useCallback } = React;

async function request(url, options) {
  let response;
  try {
    response = await fetch(url, Object.assign({ credentials: "same-origin" }, options));
  } catch (networkError) {
    throw new Error("Cannot reach the server. Check your connection and try again.");
  }
  let data = null;
  try {
    data = await response.json();
  } catch (parseError) {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(data && data.error ? data.error : "Something went wrong. Try again in a moment.");
    error.status = response.status;
    throw error;
  }
  return data;
}

const api = {
  get: (url) => request(url),
  postJson: (url, body) =>
    request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  remove: (url) => request(url, { method: "DELETE" }),
  upload: (url, method, formData, onProgress) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url);
      xhr.withCredentials = true;
      xhr.responseType = "json";
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };
      xhr.onload = () => {
        const data = xhr.response;
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
          return;
        }
        const error = new Error(data && data.error ? data.error : "Upload failed. Try again.");
        error.status = xhr.status;
        reject(error);
      };
      xhr.onerror = () => reject(new Error("Cannot reach the server. Check your connection and try again."));
      xhr.send(formData);
    }),
};

function formatSize(bytes) {
  if (!bytes) {
    return "Size unknown";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const shown = value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1);
  return shown + " " + units[index];
}

function hueFor(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 360;
  }
  return hash;
}

function initialsFor(title) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return "?";
  }
  const letters = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
  return letters.toUpperCase();
}

function Cover(props) {
  const game = props.game;
  const extra = props.className ? " " + props.className : "";
  if (game.cover_url) {
    return h("img", {
      className: "cover" + extra,
      src: game.cover_url,
      alt: game.title + " cover",
      loading: "lazy",
    });
  }
  const hue = hueFor(game.title);
  const background =
    "linear-gradient(145deg, hsl(" + hue + " 70% 58%), hsl(" + ((hue + 50) % 360) + " 65% 32%))";
  return h(
    "div",
    {
      className: "cover cover-generated" + extra,
      style: { background: background },
      role: "img",
      "aria-label": game.title + " cover",
    },
    h("span", null, initialsFor(game.title))
  );
}
