// Consentement aux témoins de Google Analytics, sur toutes les pages (repris de DossierQuébec,
// 1er oct. 2026). Google Analytics ne dépose de témoins QU'APRÈS « Accept » ; « Decline » a le
// même poids. Le choix est gardé dans le navigateur (localStorage « dsk:temoins ») et peut être
// changé avec le lien « Cookies » du pied de page, ou n'importe quel élément portant data-temoins.
// Script classique et autonome : il pose lui-même son style et sa bannière.
(function () {
  var CLE = 'dsk:temoins';

  function lire() { try { return localStorage.getItem(CLE); } catch (e) { return null; } }
  function ecrire(v) { try { localStorage.setItem(CLE, v); } catch (e) { /* navigation privée */ } }
  // Le site est en anglais par défaut ; le français vient de ?lang=fr ou du choix gardé (dsk:langue).
  function francais() {
    try {
      var p = new URLSearchParams(location.search).get('lang');
      if (p) return p === 'fr';
      return localStorage.getItem('dsk:langue') === 'fr';
    } catch (e) { return false; }
  }

  // Couleurs du design « tuiles » ; le thème sombre est lu sur <html data-theme>.
  var STYLE = '#dq-temoins{position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483000;max-width:620px;margin:0 auto;'
    + 'background:#fff;color:#0F1F17;border:1.5px solid #E3EAE5;border-radius:20px;box-shadow:0 18px 44px rgba(15,31,23,.18);'
    + 'padding:16px 18px;font:15px/1.5 Onest,system-ui,-apple-system,"Segoe UI",sans-serif}'
    + 'html[data-theme="dark"] #dq-temoins{background:#132119;color:#E8F0EA;border-color:#24372B}'
    + '#dq-temoins p{margin:0 0 12px}'
    + '#dq-temoins .dq-temoins-boutons{display:flex;gap:10px;flex-wrap:wrap}'
    + '#dq-temoins button{font:inherit;font-weight:600;padding:9px 20px;border-radius:999px;cursor:pointer;border:1.5px solid #0F1F17;background:transparent;color:inherit}'
    + 'html[data-theme="dark"] #dq-temoins button{border-color:#E8F0EA}'
    + '#dq-temoins button[data-choix="oui"]{background:#16A34A;border-color:#16A34A;color:#fff}'
    + '#dq-temoins button:hover,#dq-temoins button:focus-visible{filter:brightness(.92)}';

  function banniere() {
    if (document.getElementById('dq-temoins')) return;
    var fr = francais();
    if (!document.getElementById('dq-temoins-style')) {
      var st = document.createElement('style');
      st.id = 'dq-temoins-style';
      st.textContent = STYLE;
      document.head.appendChild(st);
    }
    var b = document.createElement('div');
    b.id = 'dq-temoins';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-label', fr ? 'Témoins' : 'Cookies');
    b.innerHTML = '<p>' + (fr
      ? 'DossierSaskatchewan aimerait utiliser <strong>Google Analytics</strong> pour compter les visites. Il dépose des témoins (cookies). Rien d’autre ne change si vous refusez.'
      : 'DossierSaskatchewan would like to use <strong>Google Analytics</strong> to count visits. It sets cookies. Nothing else changes if you decline.')
      + '</p><div class="dq-temoins-boutons"><button type="button" data-choix="oui">' + (fr ? 'Accepter' : 'Accept')
      + '</button><button type="button" data-choix="non">' + (fr ? 'Refuser' : 'Decline') + '</button></div>';
    b.addEventListener('click', function (e) {
      var choix = e.target.closest && e.target.closest('[data-choix]');
      if (!choix) return;
      var v = choix.getAttribute('data-choix');
      ecrire(v);
      b.remove();
      if (typeof window.gtag === 'function') window.gtag('consent', 'update', { analytics_storage: v === 'oui' ? 'granted' : 'denied' });
    });
    document.body.appendChild(b);
  }

  // Changer d'avis : un clic sur tout élément data-temoins rouvre la bannière. Un refus après une
  // acceptation prend effet au prochain chargement de page (gtag déjà chargé ne se décharge pas).
  document.addEventListener('click', function (e) {
    var l = e.target.closest && e.target.closest('[data-temoins]');
    if (!l) return;
    e.preventDefault();
    banniere();
  });

  // Le lien « Cookies » au bas de chaque page, à côté de Facebook et du fil RSS.
  function lienPied() {
    var groupe = document.querySelector('footer .footer-right-group') || document.querySelector('footer');
    if (!groupe || groupe.querySelector('[data-temoins]')) return;
    var a = document.createElement('a');
    a.href = '#';
    a.className = 'footer-gh';
    a.setAttribute('data-temoins', '');
    a.textContent = francais() ? 'Témoins' : 'Cookies';
    groupe.appendChild(a);
  }

  function auChargement(f) { if (document.body) f(); else document.addEventListener('DOMContentLoaded', f); }
  auChargement(lienPied);

  var choix = lire();
  if (choix !== 'oui' && choix !== 'non') auChargement(banniere);
})();
