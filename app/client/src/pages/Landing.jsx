import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import DemoSky from '../components/DemoSky.jsx';
import { LinkIcon } from '../components/Icons.jsx';
import Mark from '../components/Mark.jsx';
import { useAuth } from '../lib/auth.jsx';
import { PENDING_LINK } from '../lib/pending.js';

export default function Landing() {
  const [url, setUrl] = useState('');
  const navigate = useNavigate();
  const { user } = useAuth();

  // Signed in, the page is just a way back in.
  const startHref = user ? '/home' : '/register';
  const startLabel = user ? 'Open your sky' : 'Start your brain';

  // A link pasted here survives the sign-up and is the first thing read.
  const start = (e) => {
    e.preventDefault();
    if (url.trim()) sessionStorage.setItem(PENDING_LINK, url.trim());
    navigate(user ? '/home' : '/register');
  };

  return (
    <div className="page landing">
      <div className="landing-sky">
        <DemoSky showLabels={false} dim />
      </div>
      <div className="landing-sky-fade" />

      <header className="landing-nav">
        <Mark size={16} glow={14} style={{ marginRight: 'auto' }} />
        <a className="quiet" href="#how">
          How it works
        </a>
        {!user && (
          <Link className="quiet" to="/login">
            Log in
          </Link>
        )}
        <Link className="btn btn-primary" to={startHref}>
          {startLabel}
        </Link>
      </header>

      <section className="hero">
        <span className="kicker">Personal knowledge, mapped</span>
        <h1>You already read enough. Now remember it.</h1>
        <p>
          Paste a link. We read the article, write you a hundred words, and hang it in a sky with everything else
          you've read. The things that belong together drift together.
        </p>
        <form className="paste-row" onSubmit={start}>
          <div className="input">
            <LinkIcon />
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste the link you just closed…"
              aria-label="Article link"
            />
          </div>
          <button className="btn btn-primary" style={{ minHeight: 44, paddingInline: 20 }} type="submit">
            Remember it
          </button>
        </form>
        <div className="fineprint">Free while it's small. No card, no newsletter.</div>
      </section>

      <div className="landing-section" style={{ marginTop: 150 }}>
        <hr className="fade-rule" style={{ marginLeft: -64, marginRight: -64 }} />
      </div>

      <section className="how" id="how">
        <div>
          <div className="kicker">01 · FETCH</div>
          <h3>It reads the page, not the ads</h3>
          <p>
            Nav bars, cookie walls, related-stories rails — stripped. What's left is the article, and the article is
            what gets thought about.
          </p>
        </div>
        <div>
          <div className="kicker">02 · DISTIL</div>
          <h3>A hundred words you'll actually reread</h3>
          <p>
            Plain prose, no preamble, plus three to five tags chosen to be shared — so two pieces on the same subject
            land under the same word.
          </p>
        </div>
        <div>
          <div className="kicker">03 · CONNECT</div>
          <h3>Ideas find their neighbours</h3>
          <p>
            Every article is placed by meaning, not by folder. Edges appear where two things are genuinely about the
            same thing.
          </p>
        </div>
      </section>

      <section className="stat-band">
        <div style={{ flex: 1 }}>
          <div className="num">1,284</div>
          <div className="cap">articles a typical user closes and forgets each year</div>
        </div>
        <div className="rule" />
        <div style={{ flex: 1 }}>
          <div className="num">11 s</div>
          <div className="cap">from pasting a link to seeing it hung in your sky</div>
        </div>
        <div className="rule" />
        <div style={{ flex: 1 }}>
          <div className="num">0</div>
          <div className="cap">folders to name, maintain, and eventually abandon</div>
        </div>
      </section>

      <section className="map-pitch">
        <div>
          <h3>Search is a last resort. The map is the point.</h3>
          <p>
            Type a couple of characters and the sky steps back to make room for a list. Clear the field and it returns
            exactly as you left it — same positions, same clusters, nothing re-simulated.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 26 }}>
            <span className="tag tag-accent">machine learning</span>
            <span className="tag tag-neutral">systems design</span>
            <span className="tag tag-neutral">urbanism</span>
            <span className="tag tag-accent-2">fermentation</span>
            <span className="tag tag-neutral">climate</span>
          </div>
        </div>
        <div className="map-preview">
          <DemoSky showLabels={false} />
        </div>
      </section>

      <div className="landing-section" style={{ marginTop: 112 }}>
        <hr className="fade-rule" style={{ marginLeft: -64, marginRight: -64 }} />
        <div className="closer">
          <div style={{ flex: 1 }}>
            <h3>What did you read today?</h3>
            <p style={{ margin: 0, fontSize: 15, color: 'rgba(233,233,237,.55)' }}>
              Start with one link. The sky fills faster than you'd think.
            </p>
          </div>
          <Link className="btn btn-primary" style={{ minHeight: 44, paddingInline: 24 }} to={startHref}>
            {startLabel}
          </Link>
        </div>

        <footer className="landing-footer">
          <div style={{ width: 9, height: 9, borderRadius: '50%', background: 'rgba(145,132,217,.7)' }} />
          <span>Second Brain</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <a href="#how">How it works</a>
          {user ? <Link to="/sky">Your sky</Link> : <Link to="/login">Log in</Link>}
          <span style={{ marginLeft: 'auto' }}>Your reading, yours alone.</span>
        </footer>
      </div>
    </div>
  );
}
