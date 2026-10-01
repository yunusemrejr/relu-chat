/* Live filter for the /learn/ topic index. Without JS the full list simply stays visible. */
(function () {
  'use strict';
  var input = document.getElementById('topic-filter');
  if (!input) return;
  var items = [].slice.call(document.querySelectorAll('.index-list li'));
  var groups = [].slice.call(document.querySelectorAll('.index-group'));
  var empty = document.getElementById('index-empty');
  input.addEventListener('input', function () {
    var q = input.value.trim().toLowerCase();
    var shown = 0;
    items.forEach(function (li) {
      var hit = !q || li.getAttribute('data-name').indexOf(q) !== -1;
      li.hidden = !hit;
      if (hit) shown++;
    });
    groups.forEach(function (g) { g.hidden = !g.querySelector('li:not([hidden])'); });
    if (empty) empty.hidden = shown !== 0;
  });
})();
