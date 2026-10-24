import { useState } from "react";
import "./App.css";

const API_BASE = import.meta.env.DEV
  ? "" // relative — Vite proxies /api -> backend on :8000 in dev
  : import.meta.env.VITE_API_BASE || "https://fit-flow-fh0m.onrender.com";

const DEFAULT_FORM = {
  workout_type: "",
  duration: "",
  difficulty: "",
  equipment: "",
  fitness_goal: "",
  limitations: "",
};

const DIFFICULTY_OPTIONS = ["Beginner", "Intermediate", "Advanced"];

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

// Simple stylized raven head: dark head, sharp beak, crimson eye.
function CrowEmblem({ className }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <path
        d="M44 20c-3-7-11-11-19-9C15 13 9 22 11 33c2 11 12 19 23 17 9-1 15-8 16-13-4 2-9 1-12-2 3-3 6-9 6-15z"
        fill="#0c0d10"
        stroke="#2a2f3a"
        strokeWidth="2"
      />
      <path d="M44 27l15 3-15 3 3-4z" fill="#1a1e26" stroke="#2a2f3a" strokeWidth="1.5" />
      <circle cx="27" cy="26" r="3.4" fill="#e23b3b" />
    </svg>
  );
}

function EmptyState() {
  return (
    <div className="empty">
      <CrowEmblem className="crow" />
      <h2 className="empty__word">FITFLOW</h2>
      <p className="empty__tag">
        Your shadow trainer. Set your limits — it returns the routine.
      </p>
      <ul className="empty__list">
        <li>Warm-up · Main · Cool-down</li>
        <li>Honors your equipment &amp; movements to avoid</li>
        <li>Clean JSON, zero fluff</li>
      </ul>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="loading">
      <span className="spinner" />
      <p className="loading__word">Summoning your routine…</p>
      <span className="loading__hint">This can take a minute or two.</span>
    </div>
  );
}

function ErrorPanel({ message }) {
  return (
    <div className="empty">
      <div className="empty__badge">!</div>
      <h2 className="empty__word">Stumble</h2>
      <p className="empty__tag">{message}</p>
    </div>
  );
}

function Phase({ title, exercises }) {
  if (!exercises || exercises.length === 0) return null;
  return (
    <section className="phase">
      <h3>{title}</h3>
      <ul>
        {exercises.map((ex, i) => (
          <li key={`${ex.name}-${i}`}>
            <div className="exercise-head">
              <strong>{ex.name}</strong>
              <span className="exercise-dose">
                {[
                  ex.sets && `${ex.sets} sets`,
                  ex.reps ?? null,
                  ex.reps == null && ex.duration_seconds != null
                    ? `${ex.duration_seconds}s`
                    : null,
                  ex.rest_seconds != null ? `${ex.rest_seconds}s rest` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
            <p>{ex.instructions}</p>
            <span className="tag">{ex.equipment || "Bodyweight"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function WorkoutView({ data }) {
  if (data.status !== "ok") {
    return (
      <div className="result unable">
        <h2 className="result__title">Couldn&apos;t build that routine</h2>
        <p className="result__msg">{data.message}</p>
        {data.safety_notes?.length > 0 && (
          <ul className="result__safety-list">
            {data.safety_notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const s = data.summary || {};
  return (
    <div className="result">
      <div className="summary">
        <span>{s.focus}</span>
        <span>{s.difficulty}</span>
        <span>{s.goal}</span>
        <span>{s.estimated_total_minutes} min</span>
      </div>

      <Phase title="Warm up" exercises={data.warm_up} />
      <Phase title="Main workout" exercises={data.main_workout} />
      <Phase title="Cool down" exercises={data.cool_down} />

      {data.safety_notes?.length > 0 && (
        <section className="safety">
          <h3>Safety notes</h3>
          <ul>
            {data.safety_notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function App() {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (e) =>
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/generate-workout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || `Request failed (${res.status})`);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err.message || "Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      {/* LEFT PANEL — the form */}
      <section className="panel panel--left">
        <div className="brand">
          <CrowEmblem className="brand__crow" />
          <span className="brand__name">FITFLOW</span>
        </div>
        <p className="brand__tag">Train sharp. Move quiet.</p>

        <form className="workout-form" onSubmit={handleSubmit}>
          <div className="grid">
            <Field label="Focus">
              <input
                name="workout_type"
                value={form.workout_type}
                onChange={handleChange}
                placeholder="Full body strength"
              />
            </Field>

            <Field label="Duration">
              <input
                name="duration"
                value={form.duration}
                onChange={handleChange}
                placeholder="30 minutes"
              />
            </Field>

            <Field label="Difficulty">
              <select
                name="difficulty"
                value={form.difficulty}
                onChange={handleChange}
              >
                <option value="" disabled>
                  Select difficulty
                </option>
                {DIFFICULTY_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Goal">
              <input
                name="fitness_goal"
                value={form.fitness_goal}
                onChange={handleChange}
                placeholder="Build general strength"
              />
            </Field>

            <Field label="Equipment">
              <textarea
                name="equipment"
                value={form.equipment}
                onChange={handleChange}
                rows={2}
                placeholder="Dumbbells, yoga mat (leave blank for bodyweight)"
              />
            </Field>

            <Field label="Movements to avoid">
              <textarea
                name="limitations"
                value={form.limitations}
                onChange={handleChange}
                rows={2}
                placeholder="Jumping, overhead pressing"
              />
            </Field>
          </div>

          <button type="submit" disabled={loading}>
            {loading ? (
              <>
                <span className="spinner" /> Summoning…
              </>
            ) : (
              "Generate"
            )}
          </button>
        </form>
      </section>

      {/* RIGHT PANEL — the response (or empty/loading/error state) */}
      <section className="panel panel--right">
        {error ? (
          <ErrorPanel message={error} />
        ) : loading ? (
          <LoadingState />
        ) : result ? (
          <WorkoutView data={result} />
        ) : (
          <EmptyState />
        )}
      </section>
    </div>
  );
}

export default App;
