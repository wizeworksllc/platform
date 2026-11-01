// silicaui-react checks, in development, that its CSS plugin is loaded by reading
// the `--sui-plugin` sentinel the plugin sets on <html>. Tests load no CSS, so the
// check retries for 3 seconds, and a retry that outlives the test file runs after
// jsdom is torn down and throws `getComputedStyle is not defined` (it failed
// @wizeworksllc/ui on CI). Setting the sentinel says what is true for a unit
// test: styling is not under test.
document.documentElement.style.setProperty('--sui-plugin', '1');
