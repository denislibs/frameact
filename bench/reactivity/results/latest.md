# Benchmark snapshot

2026-10-12T19:46:34.886Z → 2026-10-12T19:54:22.544Z

**passed** · full · observed graphs · CellX standard

v24.3.0 · Apple M1 Pro · darwin arm64

544 measurements; 0 failed suites. Times are milliseconds. Each framework/suite runs in a fresh process; values are the minimum of 3 samples. Explicit GC is outside timing. Raw samples are in the adjacent JSON file. See the repository README for workload definitions and limitations.

## Comparison by workload family

Geometric mean of each case's time divided by the fastest engine on that case. Lower is better; 1× means fastest on every case in that family. Cases have equal weight within a family. There is no overall score. Small CellX timings are particularly sensitive to noise.

| Engine | kairo | mol | s | dynamic | cellx |
| --- | ---: | ---: | ---: | ---: | ---: |
| alien-signals | 1.01× | 1.35× | 1.02× | 1.00× | 1.00× |
| @angular/signals | 3.37× | 1.38× | 2.43× | 2.91× | 2.43× |
| MobX | 3.83× | 1.38× | 3.59× | 2.64× | 4.84× |
| $mol_wire | 4.24× | 1.00× | 3.91× | 2.15× | 2.22× |
| Oby | 2.24× | 1.63× | 3.36× | 1.99× | 3.26× |
| Pota | 3.12× | 1.62× | 2.73× | 2.05× | 1.42× |
| x-reactivity | 3.74× | 1.66× | 2.95× | 2.85× | 3.24× |
| Preact Signals | 1.28× | 1.36× | 1.28× | 1.32× | 2.43× |
| TC39 Signals Polyfill | 7.20× | 1.44× | 3.78× | 11.34× | 2.80× |
| SolidJS | 3.96× | 1.64× | 2.72× | 3.40× | 1.97× |
| Svelte v5 | 4.23× | 1.40× | 2.78× | 2.22× | 142.85× |
| @amadeus-it-group/tansu | 3.02× | 1.38× | 2.60× | 1.98× | 2.45× |
| @tldraw/state | 3.88× | 1.39× | 2.50× | 5.44× | 3.57× |
| uSignal | 3.33× | 1.89× | 2.32× | 2.41× | 2.24× |
| @vue/reactivity | 2.11× | 1.36× | 1.50× | 1.67× | 2.82× |
| frameact | 1.65× | 1.35× | 1.63× | 1.38× | 3.36× |

## Packages

| Package | Version |
| --- | --- |
| alien-signals | 3.2.1 |
| @angular/core | 22.1.7 |
| mobx | 7.0.3 |
| mol_wire_lib | 1.0.1781 |
| oby | 15.1.2 |
| pota | 0.22.235 |
| @solidjs/signals | 2.0.0-rc.0 |
| @preact/signals-core | 1.14.4 |
| signal-polyfill | 0.2.2 |
| solid-js | 1.9.15 |
| svelte | 5.57.0 |
| @amadeus-it-group/tansu | 2.0.0 |
| @tldraw/state | 5.4.2 |
| usignal | 0.10.0 |
| @vue/reactivity | 3.5.43 |
| frameact | 0.0.0 |

## Measurements

| Framework | Suite | Test | ms |
| --- | --- | --- | ---: |
| alien-signals | kairo | avoidablePropagation | 79.1989 |
| alien-signals | kairo | broadPropagation | 176.6913 |
| alien-signals | kairo | deepPropagation | 63.6521 |
| alien-signals | kairo | diamond | 115.8006 |
| alien-signals | kairo | mux | 191.3180 |
| alien-signals | kairo | repeatedObservers | 13.0177 |
| alien-signals | kairo | triangle | 41.2902 |
| alien-signals | kairo | unstable | 39.5618 |
| alien-signals | mol | molBench | 478.5583 |
| alien-signals | s | createDataSignals | 5.4647 |
| alien-signals | s | createComputations0to1 | 3.6121 |
| alien-signals | s | createComputations1to1 | 9.2354 |
| alien-signals | s | createComputations2to1 | 7.8806 |
| alien-signals | s | createComputations4to1 | 7.2317 |
| alien-signals | s | createComputations1000to1 | 6.2589 |
| alien-signals | s | createComputations1to2 | 7.1872 |
| alien-signals | s | createComputations1to4 | 6.4496 |
| alien-signals | s | createComputations1to8 | 5.7874 |
| alien-signals | s | createComputations1to1000 | 5.5268 |
| alien-signals | s | updateComputations1to1 | 20.2573 |
| alien-signals | s | updateComputations2to1 | 13.1133 |
| alien-signals | s | updateComputations4to1 | 8.8969 |
| alien-signals | s | updateComputations1000to1 | 4.6085 |
| alien-signals | s | updateComputations1to2 | 16.1028 |
| alien-signals | s | updateComputations1to4 | 13.6376 |
| alien-signals | s | updateComputations1to1000 | 14.0992 |
| alien-signals | dynamic | 10x5 - 2 sources - read 20% (simple component) | 167.9252 |
| alien-signals | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 150.4047 |
| alien-signals | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 238.2572 |
| alien-signals | dynamic | 1000x5 - 25 sources (wide dense) | 441.3873 |
| alien-signals | dynamic | 5x500 - 3 sources (deep) | 109.4131 |
| alien-signals | cellx | cellx10 | 0.0378 |
| alien-signals | cellx | cellx20 | 0.0367 |
| alien-signals | cellx | cellx30 | 0.0297 |
| @angular/signals | kairo | avoidablePropagation | 240.6761 |
| @angular/signals | kairo | broadPropagation | 656.9375 |
| @angular/signals | kairo | deepPropagation | 217.5173 |
| @angular/signals | kairo | diamond | 366.6354 |
| @angular/signals | kairo | mux | 501.2689 |
| @angular/signals | kairo | repeatedObservers | 45.0129 |
| @angular/signals | kairo | triangle | 154.0844 |
| @angular/signals | kairo | unstable | 143.1787 |
| @angular/signals | mol | molBench | 488.5672 |
| @angular/signals | s | createDataSignals | 41.2887 |
| @angular/signals | s | createComputations0to1 | 8.2362 |
| @angular/signals | s | createComputations1to1 | 45.1682 |
| @angular/signals | s | createComputations2to1 | 39.1399 |
| @angular/signals | s | createComputations4to1 | 36.9805 |
| @angular/signals | s | createComputations1000to1 | 17.7830 |
| @angular/signals | s | createComputations1to2 | 17.4960 |
| @angular/signals | s | createComputations1to4 | 14.9224 |
| @angular/signals | s | createComputations1to8 | 12.8685 |
| @angular/signals | s | createComputations1to1000 | 10.4762 |
| @angular/signals | s | updateComputations1to1 | 28.3790 |
| @angular/signals | s | updateComputations2to1 | 17.6961 |
| @angular/signals | s | updateComputations4to1 | 11.6866 |
| @angular/signals | s | updateComputations1000to1 | 5.6163 |
| @angular/signals | s | updateComputations1to2 | 27.6906 |
| @angular/signals | s | updateComputations1to4 | 26.2863 |
| @angular/signals | s | updateComputations1to1000 | 25.1852 |
| @angular/signals | dynamic | 10x5 - 2 sources - read 20% (simple component) | 590.9407 |
| @angular/signals | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 433.5650 |
| @angular/signals | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 663.4898 |
| @angular/signals | dynamic | 1000x5 - 25 sources (wide dense) | 1152.2775 |
| @angular/signals | dynamic | 5x500 - 3 sources (deep) | 310.8015 |
| @angular/signals | cellx | cellx10 | 0.0766 |
| @angular/signals | cellx | cellx20 | 0.0944 |
| @angular/signals | cellx | cellx30 | 0.0820 |
| MobX | kairo | avoidablePropagation | 366.0820 |
| MobX | kairo | broadPropagation | 963.8863 |
| MobX | kairo | deepPropagation | 371.2514 |
| MobX | kairo | diamond | 494.3055 |
| MobX | kairo | mux | 496.9307 |
| MobX | kairo | repeatedObservers | 36.9185 |
| MobX | kairo | triangle | 168.0173 |
| MobX | kairo | unstable | 86.5450 |
| MobX | mol | molBench | 490.4720 |
| MobX | s | createDataSignals | 7.5906 |
| MobX | s | createComputations0to1 | 30.3812 |
| MobX | s | createComputations1to1 | 62.1605 |
| MobX | s | createComputations2to1 | 37.2215 |
| MobX | s | createComputations4to1 | 20.9737 |
| MobX | s | createComputations1000to1 | 12.9833 |
| MobX | s | createComputations1to2 | 54.0217 |
| MobX | s | createComputations1to4 | 48.2137 |
| MobX | s | createComputations1to8 | 44.1875 |
| MobX | s | createComputations1to1000 | 44.9366 |
| MobX | s | updateComputations1to1 | 47.7050 |
| MobX | s | updateComputations2to1 | 27.2366 |
| MobX | s | updateComputations4to1 | 16.5863 |
| MobX | s | updateComputations1000to1 | 6.6393 |
| MobX | s | updateComputations1to2 | 42.7713 |
| MobX | s | updateComputations1to4 | 39.1463 |
| MobX | s | updateComputations1to1000 | 36.6285 |
| MobX | dynamic | 10x5 - 2 sources - read 20% (simple component) | 646.8964 |
| MobX | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 414.4853 |
| MobX | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 551.7015 |
| MobX | dynamic | 1000x5 - 25 sources (wide dense) | 806.4123 |
| MobX | dynamic | 5x500 - 3 sources (deep) | 311.1630 |
| MobX | cellx | cellx10 | 0.1494 |
| MobX | cellx | cellx20 | 0.1104 |
| MobX | cellx | cellx30 | 0.2831 |
| $mol_wire | kairo | avoidablePropagation | 275.9938 |
| $mol_wire | kairo | broadPropagation | 913.8386 |
| $mol_wire | kairo | deepPropagation | 267.9627 |
| $mol_wire | kairo | diamond | 373.9544 |
| $mol_wire | kairo | mux | 615.5977 |
| $mol_wire | kairo | repeatedObservers | 81.8512 |
| $mol_wire | kairo | triangle | 139.6158 |
| $mol_wire | kairo | unstable | 221.2100 |
| $mol_wire | mol | molBench | 354.6819 |
| $mol_wire | s | createDataSignals | 20.1920 |
| $mol_wire | s | createComputations0to1 | 14.7132 |
| $mol_wire | s | createComputations1to1 | 81.6337 |
| $mol_wire | s | createComputations2to1 | 33.3893 |
| $mol_wire | s | createComputations4to1 | 29.0608 |
| $mol_wire | s | createComputations1000to1 | 24.4513 |
| $mol_wire | s | createComputations1to2 | 46.4735 |
| $mol_wire | s | createComputations1to4 | 24.8717 |
| $mol_wire | s | createComputations1to8 | 23.1595 |
| $mol_wire | s | createComputations1to1000 | 19.2450 |
| $mol_wire | s | updateComputations1to1 | 63.0993 |
| $mol_wire | s | updateComputations2to1 | 36.9475 |
| $mol_wire | s | updateComputations4to1 | 23.5068 |
| $mol_wire | s | updateComputations1000to1 | 9.8991 |
| $mol_wire | s | updateComputations1to2 | 54.9477 |
| $mol_wire | s | updateComputations1to4 | 52.8522 |
| $mol_wire | s | updateComputations1to1000 | 58.7728 |
| $mol_wire | dynamic | 10x5 - 2 sources - read 20% (simple component) | 520.2138 |
| $mol_wire | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 311.2056 |
| $mol_wire | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 485.6990 |
| $mol_wire | dynamic | 1000x5 - 25 sources (wide dense) | 665.7892 |
| $mol_wire | dynamic | 5x500 - 3 sources (deep) | 253.1809 |
| $mol_wire | cellx | cellx10 | 0.0860 |
| $mol_wire | cellx | cellx20 | 0.0598 |
| $mol_wire | cellx | cellx30 | 0.0875 |
| Oby | kairo | avoidablePropagation | 180.2985 |
| Oby | kairo | broadPropagation | 474.1739 |
| Oby | kairo | deepPropagation | 182.3559 |
| Oby | kairo | diamond | 244.6925 |
| Oby | kairo | mux | 339.4656 |
| Oby | kairo | repeatedObservers | 33.2162 |
| Oby | kairo | triangle | 107.9242 |
| Oby | kairo | unstable | 52.1506 |
| Oby | mol | molBench | 576.5897 |
| Oby | s | createDataSignals | 10.4497 |
| Oby | s | createComputations0to1 | 26.5358 |
| Oby | s | createComputations1to1 | 70.7398 |
| Oby | s | createComputations2to1 | 46.6862 |
| Oby | s | createComputations4to1 | 17.2355 |
| Oby | s | createComputations1000to1 | 12.9262 |
| Oby | s | createComputations1to2 | 41.7785 |
| Oby | s | createComputations1to4 | 40.0882 |
| Oby | s | createComputations1to8 | 36.7045 |
| Oby | s | createComputations1to1000 | 35.5951 |
| Oby | s | updateComputations1to1 | 38.3045 |
| Oby | s | updateComputations2to1 | 23.6098 |
| Oby | s | updateComputations4to1 | 14.5798 |
| Oby | s | updateComputations1000to1 | 10.0993 |
| Oby | s | updateComputations1to2 | 35.3005 |
| Oby | s | updateComputations1to4 | 31.8504 |
| Oby | s | updateComputations1to1000 | 31.6499 |
| Oby | dynamic | 10x5 - 2 sources - read 20% (simple component) | 407.9412 |
| Oby | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 301.8705 |
| Oby | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 483.2975 |
| Oby | dynamic | 1000x5 - 25 sources (wide dense) | 633.5824 |
| Oby | dynamic | 5x500 - 3 sources (deep) | 239.4940 |
| Oby | cellx | cellx10 | 0.1003 |
| Oby | cellx | cellx20 | 0.0863 |
| Oby | cellx | cellx30 | 0.1643 |
| Pota | kairo | avoidablePropagation | 338.0822 |
| Pota | kairo | broadPropagation | 546.8451 |
| Pota | kairo | deepPropagation | 216.0798 |
| Pota | kairo | diamond | 325.0542 |
| Pota | kairo | mux | 351.3668 |
| Pota | kairo | repeatedObservers | 70.1222 |
| Pota | kairo | triangle | 109.4607 |
| Pota | kairo | unstable | 95.4880 |
| Pota | mol | molBench | 575.0700 |
| Pota | s | createDataSignals | 9.1418 |
| Pota | s | createComputations0to1 | 8.7453 |
| Pota | s | createComputations1to1 | 44.3468 |
| Pota | s | createComputations2to1 | 42.3673 |
| Pota | s | createComputations4to1 | 14.0556 |
| Pota | s | createComputations1000to1 | 11.0028 |
| Pota | s | createComputations1to2 | 45.2558 |
| Pota | s | createComputations1to4 | 15.0789 |
| Pota | s | createComputations1to8 | 13.4836 |
| Pota | s | createComputations1to1000 | 11.7526 |
| Pota | s | updateComputations1to1 | 61.9193 |
| Pota | s | updateComputations2to1 | 36.5965 |
| Pota | s | updateComputations4to1 | 22.2294 |
| Pota | s | updateComputations1000to1 | 9.2216 |
| Pota | s | updateComputations1to2 | 47.0120 |
| Pota | s | updateComputations1to4 | 37.6314 |
| Pota | s | updateComputations1to1000 | 30.0926 |
| Pota | dynamic | 10x5 - 2 sources - read 20% (simple component) | 548.1892 |
| Pota | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 301.9747 |
| Pota | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 406.2097 |
| Pota | dynamic | 1000x5 - 25 sources (wide dense) | 648.1686 |
| Pota | dynamic | 5x500 - 3 sources (deep) | 240.6281 |
| Pota | cellx | cellx10 | 0.0567 |
| Pota | cellx | cellx20 | 0.0529 |
| Pota | cellx | cellx30 | 0.0393 |
| x-reactivity | kairo | avoidablePropagation | 347.1518 |
| x-reactivity | kairo | broadPropagation | 719.6729 |
| x-reactivity | kairo | deepPropagation | 235.0726 |
| x-reactivity | kairo | diamond | 481.3542 |
| x-reactivity | kairo | mux | 283.8122 |
| x-reactivity | kairo | repeatedObservers | 79.1463 |
| x-reactivity | kairo | triangle | 167.1395 |
| x-reactivity | kairo | unstable | 134.8145 |
| x-reactivity | mol | molBench | 589.5667 |
| x-reactivity | s | createDataSignals | 9.0248 |
| x-reactivity | s | createComputations0to1 | 8.7583 |
| x-reactivity | s | createComputations1to1 | 52.8198 |
| x-reactivity | s | createComputations2to1 | 18.5190 |
| x-reactivity | s | createComputations4to1 | 15.1178 |
| x-reactivity | s | createComputations1000to1 | 11.7083 |
| x-reactivity | s | createComputations1to2 | 18.5447 |
| x-reactivity | s | createComputations1to4 | 14.8288 |
| x-reactivity | s | createComputations1to8 | 13.4576 |
| x-reactivity | s | createComputations1to1000 | 12.4227 |
| x-reactivity | s | updateComputations1to1 | 112.1968 |
| x-reactivity | s | updateComputations2to1 | 64.5275 |
| x-reactivity | s | updateComputations4to1 | 37.2418 |
| x-reactivity | s | updateComputations1000to1 | 10.4060 |
| x-reactivity | s | updateComputations1to2 | 71.1754 |
| x-reactivity | s | updateComputations1to4 | 49.0833 |
| x-reactivity | s | updateComputations1to1000 | 36.9915 |
| x-reactivity | dynamic | 10x5 - 2 sources - read 20% (simple component) | 1373.9842 |
| x-reactivity | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 392.6908 |
| x-reactivity | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 522.5127 |
| x-reactivity | dynamic | 1000x5 - 25 sources (wide dense) | 772.4283 |
| x-reactivity | dynamic | 5x500 - 3 sources (deep) | 252.2235 |
| x-reactivity | cellx | cellx10 | 0.1592 |
| x-reactivity | cellx | cellx20 | 0.1119 |
| x-reactivity | cellx | cellx30 | 0.0787 |
| Preact Signals | kairo | avoidablePropagation | 104.0845 |
| Preact Signals | kairo | broadPropagation | 201.6470 |
| Preact Signals | kairo | deepPropagation | 99.6858 |
| Preact Signals | kairo | diamond | 163.4629 |
| Preact Signals | kairo | mux | 227.5791 |
| Preact Signals | kairo | repeatedObservers | 15.2384 |
| Preact Signals | kairo | triangle | 63.9637 |
| Preact Signals | kairo | unstable | 35.4341 |
| Preact Signals | mol | molBench | 483.8844 |
| Preact Signals | s | createDataSignals | 6.7229 |
| Preact Signals | s | createComputations0to1 | 5.7141 |
| Preact Signals | s | createComputations1to1 | 20.3530 |
| Preact Signals | s | createComputations2to1 | 11.8026 |
| Preact Signals | s | createComputations4to1 | 7.8678 |
| Preact Signals | s | createComputations1000to1 | 8.6734 |
| Preact Signals | s | createComputations1to2 | 11.9811 |
| Preact Signals | s | createComputations1to4 | 11.2128 |
| Preact Signals | s | createComputations1to8 | 10.0658 |
| Preact Signals | s | createComputations1to1000 | 5.0662 |
| Preact Signals | s | updateComputations1to1 | 20.9182 |
| Preact Signals | s | updateComputations2to1 | 13.7084 |
| Preact Signals | s | updateComputations4to1 | 9.1016 |
| Preact Signals | s | updateComputations1000to1 | 5.3510 |
| Preact Signals | s | updateComputations1to2 | 15.5092 |
| Preact Signals | s | updateComputations1to4 | 14.4314 |
| Preact Signals | s | updateComputations1to1000 | 11.9593 |
| Preact Signals | dynamic | 10x5 - 2 sources - read 20% (simple component) | 250.7385 |
| Preact Signals | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 201.6211 |
| Preact Signals | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 309.3767 |
| Preact Signals | dynamic | 1000x5 - 25 sources (wide dense) | 490.7793 |
| Preact Signals | dynamic | 5x500 - 3 sources (deep) | 153.1347 |
| Preact Signals | cellx | cellx10 | 0.0740 |
| Preact Signals | cellx | cellx20 | 0.1164 |
| Preact Signals | cellx | cellx30 | 0.0687 |
| TC39 Signals Polyfill | kairo | avoidablePropagation | 322.4084 |
| TC39 Signals Polyfill | kairo | broadPropagation | 1151.0539 |
| TC39 Signals Polyfill | kairo | deepPropagation | 354.6880 |
| TC39 Signals Polyfill | kairo | diamond | 619.7409 |
| TC39 Signals Polyfill | kairo | mux | 902.4456 |
| TC39 Signals Polyfill | kairo | repeatedObservers | 214.8538 |
| TC39 Signals Polyfill | kairo | triangle | 253.9839 |
| TC39 Signals Polyfill | kairo | unstable | 672.0187 |
| TC39 Signals Polyfill | mol | molBench | 511.4063 |
| TC39 Signals Polyfill | s | createDataSignals | 17.9800 |
| TC39 Signals Polyfill | s | createComputations0to1 | 23.1122 |
| TC39 Signals Polyfill | s | createComputations1to1 | 58.4134 |
| TC39 Signals Polyfill | s | createComputations2to1 | 36.3318 |
| TC39 Signals Polyfill | s | createComputations4to1 | 29.0378 |
| TC39 Signals Polyfill | s | createComputations1000to1 | 19.8241 |
| TC39 Signals Polyfill | s | createComputations1to2 | 45.9309 |
| TC39 Signals Polyfill | s | createComputations1to4 | 37.9860 |
| TC39 Signals Polyfill | s | createComputations1to8 | 37.3544 |
| TC39 Signals Polyfill | s | createComputations1to1000 | 32.6570 |
| TC39 Signals Polyfill | s | updateComputations1to1 | 50.1584 |
| TC39 Signals Polyfill | s | updateComputations2to1 | 30.7212 |
| TC39 Signals Polyfill | s | updateComputations4to1 | 19.3340 |
| TC39 Signals Polyfill | s | updateComputations1000to1 | 9.1973 |
| TC39 Signals Polyfill | s | updateComputations1to2 | 44.3421 |
| TC39 Signals Polyfill | s | updateComputations1to4 | 36.4260 |
| TC39 Signals Polyfill | s | updateComputations1to1000 | 31.9406 |
| TC39 Signals Polyfill | dynamic | 10x5 - 2 sources - read 20% (simple component) | 1826.1583 |
| TC39 Signals Polyfill | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 692.4764 |
| TC39 Signals Polyfill | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 11277.7764 |
| TC39 Signals Polyfill | dynamic | 1000x5 - 25 sources (wide dense) | 8533.0440 |
| TC39 Signals Polyfill | dynamic | 5x500 - 3 sources (deep) | 447.0915 |
| TC39 Signals Polyfill | cellx | cellx10 | 0.1165 |
| TC39 Signals Polyfill | cellx | cellx20 | 0.0853 |
| TC39 Signals Polyfill | cellx | cellx30 | 0.0914 |
| SolidJS | kairo | avoidablePropagation | 346.0603 |
| SolidJS | kairo | broadPropagation | 804.3490 |
| SolidJS | kairo | deepPropagation | 335.3700 |
| SolidJS | kairo | diamond | 495.2211 |
| SolidJS | kairo | mux | 465.0875 |
| SolidJS | kairo | repeatedObservers | 64.5682 |
| SolidJS | kairo | triangle | 166.8691 |
| SolidJS | kairo | unstable | 98.2921 |
| SolidJS | mol | molBench | 581.8658 |
| SolidJS | s | createDataSignals | 7.8651 |
| SolidJS | s | createComputations0to1 | 7.6180 |
| SolidJS | s | createComputations1to1 | 39.4217 |
| SolidJS | s | createComputations2to1 | 38.0535 |
| SolidJS | s | createComputations4to1 | 11.6922 |
| SolidJS | s | createComputations1000to1 | 8.9087 |
| SolidJS | s | createComputations1to2 | 17.3592 |
| SolidJS | s | createComputations1to4 | 12.4288 |
| SolidJS | s | createComputations1to8 | 11.4886 |
| SolidJS | s | createComputations1to1000 | 10.1418 |
| SolidJS | s | updateComputations1to1 | 69.4458 |
| SolidJS | s | updateComputations2to1 | 48.9729 |
| SolidJS | s | updateComputations4to1 | 36.5631 |
| SolidJS | s | updateComputations1000to1 | 27.3619 |
| SolidJS | s | updateComputations1to2 | 45.3084 |
| SolidJS | s | updateComputations1to4 | 41.8869 |
| SolidJS | s | updateComputations1to1000 | 38.1086 |
| SolidJS | dynamic | 10x5 - 2 sources - read 20% (simple component) | 1360.2138 |
| SolidJS | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 507.5761 |
| SolidJS | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 598.7675 |
| SolidJS | dynamic | 1000x5 - 25 sources (wide dense) | 1032.4615 |
| SolidJS | dynamic | 5x500 - 3 sources (deep) | 309.8345 |
| SolidJS | cellx | cellx10 | 0.0666 |
| SolidJS | cellx | cellx20 | 0.0739 |
| SolidJS | cellx | cellx30 | 0.0642 |
| Svelte v5 | kairo | avoidablePropagation | 526.5102 |
| Svelte v5 | kairo | broadPropagation | 761.5163 |
| Svelte v5 | kairo | deepPropagation | 355.9547 |
| Svelte v5 | kairo | diamond | 541.6708 |
| Svelte v5 | kairo | mux | 322.3188 |
| Svelte v5 | kairo | repeatedObservers | 69.5230 |
| Svelte v5 | kairo | triangle | 189.7178 |
| Svelte v5 | kairo | unstable | 116.8084 |
| Svelte v5 | mol | molBench | 495.8233 |
| Svelte v5 | s | createDataSignals | 6.4274 |
| Svelte v5 | s | createComputations0to1 | 17.2950 |
| Svelte v5 | s | createComputations1to1 | 25.8545 |
| Svelte v5 | s | createComputations2to1 | 15.7055 |
| Svelte v5 | s | createComputations4to1 | 11.3324 |
| Svelte v5 | s | createComputations1000to1 | 6.1495 |
| Svelte v5 | s | createComputations1to2 | 20.1862 |
| Svelte v5 | s | createComputations1to4 | 18.1248 |
| Svelte v5 | s | createComputations1to8 | 17.0905 |
| Svelte v5 | s | createComputations1to1000 | 17.2444 |
| Svelte v5 | s | updateComputations1to1 | 146.2713 |
| Svelte v5 | s | updateComputations2to1 | 75.5055 |
| Svelte v5 | s | updateComputations4to1 | 39.8780 |
| Svelte v5 | s | updateComputations1000to1 | 4.5953 |
| Svelte v5 | s | updateComputations1to2 | 88.2631 |
| Svelte v5 | s | updateComputations1to4 | 54.8246 |
| Svelte v5 | s | updateComputations1to1000 | 24.6130 |
| Svelte v5 | dynamic | 10x5 - 2 sources - read 20% (simple component) | 721.5093 |
| Svelte v5 | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 309.2962 |
| Svelte v5 | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 506.2686 |
| Svelte v5 | dynamic | 1000x5 - 25 sources (wide dense) | 538.7113 |
| Svelte v5 | dynamic | 5x500 - 3 sources (deep) | 259.6180 |
| Svelte v5 | cellx | cellx10 | 0.1541 |
| Svelte v5 | cellx | cellx20 | 2.5426 |
| Svelte v5 | cellx | cellx30 | 306.5015 |
| @amadeus-it-group/tansu | kairo | avoidablePropagation | 258.4555 |
| @amadeus-it-group/tansu | kairo | broadPropagation | 615.2735 |
| @amadeus-it-group/tansu | kairo | deepPropagation | 185.1539 |
| @amadeus-it-group/tansu | kairo | diamond | 273.5941 |
| @amadeus-it-group/tansu | kairo | mux | 457.2895 |
| @amadeus-it-group/tansu | kairo | repeatedObservers | 51.9107 |
| @amadeus-it-group/tansu | kairo | triangle | 98.4347 |
| @amadeus-it-group/tansu | kairo | unstable | 138.0829 |
| @amadeus-it-group/tansu | mol | molBench | 489.4573 |
| @amadeus-it-group/tansu | s | createDataSignals | 10.4733 |
| @amadeus-it-group/tansu | s | createComputations0to1 | 10.1558 |
| @amadeus-it-group/tansu | s | createComputations1to1 | 40.8520 |
| @amadeus-it-group/tansu | s | createComputations2to1 | 28.3138 |
| @amadeus-it-group/tansu | s | createComputations4to1 | 15.5004 |
| @amadeus-it-group/tansu | s | createComputations1000to1 | 15.3469 |
| @amadeus-it-group/tansu | s | createComputations1to2 | 25.7074 |
| @amadeus-it-group/tansu | s | createComputations1to4 | 23.5047 |
| @amadeus-it-group/tansu | s | createComputations1to8 | 21.7308 |
| @amadeus-it-group/tansu | s | createComputations1to1000 | 20.0100 |
| @amadeus-it-group/tansu | s | updateComputations1to1 | 36.9617 |
| @amadeus-it-group/tansu | s | updateComputations2to1 | 22.5352 |
| @amadeus-it-group/tansu | s | updateComputations4to1 | 14.5856 |
| @amadeus-it-group/tansu | s | updateComputations1000to1 | 9.7408 |
| @amadeus-it-group/tansu | s | updateComputations1to2 | 32.7750 |
| @amadeus-it-group/tansu | s | updateComputations1to4 | 30.3106 |
| @amadeus-it-group/tansu | s | updateComputations1to1000 | 30.1521 |
| @amadeus-it-group/tansu | dynamic | 10x5 - 2 sources - read 20% (simple component) | 433.5534 |
| @amadeus-it-group/tansu | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 283.4342 |
| @amadeus-it-group/tansu | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 521.4819 |
| @amadeus-it-group/tansu | dynamic | 1000x5 - 25 sources (wide dense) | 625.7063 |
| @amadeus-it-group/tansu | dynamic | 5x500 - 3 sources (deep) | 222.2745 |
| @amadeus-it-group/tansu | cellx | cellx10 | 0.0968 |
| @amadeus-it-group/tansu | cellx | cellx20 | 0.0696 |
| @amadeus-it-group/tansu | cellx | cellx30 | 0.0894 |
| @tldraw/state | kairo | avoidablePropagation | 336.8562 |
| @tldraw/state | kairo | broadPropagation | 834.9132 |
| @tldraw/state | kairo | deepPropagation | 268.7148 |
| @tldraw/state | kairo | diamond | 435.9153 |
| @tldraw/state | kairo | mux | 595.4969 |
| @tldraw/state | kairo | repeatedObservers | 55.1890 |
| @tldraw/state | kairo | triangle | 193.2917 |
| @tldraw/state | kairo | unstable | 91.4948 |
| @tldraw/state | mol | molBench | 494.3433 |
| @tldraw/state | s | createDataSignals | 7.6509 |
| @tldraw/state | s | createComputations0to1 | 6.9867 |
| @tldraw/state | s | createComputations1to1 | 18.8858 |
| @tldraw/state | s | createComputations2to1 | 15.8757 |
| @tldraw/state | s | createComputations4to1 | 9.6578 |
| @tldraw/state | s | createComputations1000to1 | 12.6262 |
| @tldraw/state | s | createComputations1to2 | 17.2539 |
| @tldraw/state | s | createComputations1to4 | 15.2430 |
| @tldraw/state | s | createComputations1to8 | 14.1404 |
| @tldraw/state | s | createComputations1to1000 | 13.1572 |
| @tldraw/state | s | updateComputations1to1 | 66.9525 |
| @tldraw/state | s | updateComputations2to1 | 40.8448 |
| @tldraw/state | s | updateComputations4to1 | 27.2175 |
| @tldraw/state | s | updateComputations1000to1 | 19.9231 |
| @tldraw/state | s | updateComputations1to2 | 54.2485 |
| @tldraw/state | s | updateComputations1to4 | 45.4302 |
| @tldraw/state | s | updateComputations1to1000 | 38.7110 |
| @tldraw/state | dynamic | 10x5 - 2 sources - read 20% (simple component) | 691.4837 |
| @tldraw/state | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 421.9836 |
| @tldraw/state | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 4332.1650 |
| @tldraw/state | dynamic | 1000x5 - 25 sources (wide dense) | 3619.5657 |
| @tldraw/state | dynamic | 5x500 - 3 sources (deep) | 303.5955 |
| @tldraw/state | cellx | cellx10 | 0.1276 |
| @tldraw/state | cellx | cellx20 | 0.1248 |
| @tldraw/state | cellx | cellx30 | 0.1182 |
| uSignal | kairo | avoidablePropagation | 485.2655 |
| uSignal | kairo | broadPropagation | 661.5024 |
| uSignal | kairo | deepPropagation | 200.5281 |
| uSignal | kairo | diamond | 333.5106 |
| uSignal | kairo | mux | 596.6680 |
| uSignal | kairo | repeatedObservers | 47.0795 |
| uSignal | kairo | triangle | 139.8648 |
| uSignal | kairo | unstable | 67.2167 |
| uSignal | mol | molBench | 671.4106 |
| uSignal | s | createDataSignals | 8.9896 |
| uSignal | s | createComputations0to1 | 6.9764 |
| uSignal | s | createComputations1to1 | 34.3369 |
| uSignal | s | createComputations2to1 | 15.8099 |
| uSignal | s | createComputations4to1 | 14.8937 |
| uSignal | s | createComputations1000to1 | 12.1194 |
| uSignal | s | createComputations1to2 | 21.4431 |
| uSignal | s | createComputations1to4 | 20.8413 |
| uSignal | s | createComputations1to8 | 19.7101 |
| uSignal | s | createComputations1to1000 | 12.4600 |
| uSignal | s | updateComputations1to1 | 37.2096 |
| uSignal | s | updateComputations2to1 | 24.0499 |
| uSignal | s | updateComputations4to1 | 16.0156 |
| uSignal | s | updateComputations1000to1 | 14.0243 |
| uSignal | s | updateComputations1to2 | 30.5274 |
| uSignal | s | updateComputations1to4 | 27.3115 |
| uSignal | s | updateComputations1to1000 | 34.7473 |
| uSignal | dynamic | 10x5 - 2 sources - read 20% (simple component) | 441.4246 |
| uSignal | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 396.6452 |
| uSignal | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 478.2090 |
| uSignal | dynamic | 1000x5 - 25 sources (wide dense) | 1083.6415 |
| uSignal | dynamic | 5x500 - 3 sources (deep) | 261.1907 |
| uSignal | cellx | cellx10 | 0.0655 |
| uSignal | cellx | cellx20 | 0.0419 |
| uSignal | cellx | cellx30 | 0.1689 |
| @vue/reactivity | kairo | avoidablePropagation | 209.9238 |
| @vue/reactivity | kairo | broadPropagation | 461.1899 |
| @vue/reactivity | kairo | deepPropagation | 142.6129 |
| @vue/reactivity | kairo | diamond | 218.6414 |
| @vue/reactivity | kairo | mux | 412.7272 |
| @vue/reactivity | kairo | repeatedObservers | 24.8893 |
| @vue/reactivity | kairo | triangle | 75.9415 |
| @vue/reactivity | kairo | unstable | 62.5425 |
| @vue/reactivity | mol | molBench | 482.2073 |
| @vue/reactivity | s | createDataSignals | 7.5878 |
| @vue/reactivity | s | createComputations0to1 | 6.7935 |
| @vue/reactivity | s | createComputations1to1 | 15.1430 |
| @vue/reactivity | s | createComputations2to1 | 11.1372 |
| @vue/reactivity | s | createComputations4to1 | 9.7677 |
| @vue/reactivity | s | createComputations1000to1 | 10.8420 |
| @vue/reactivity | s | createComputations1to2 | 13.3650 |
| @vue/reactivity | s | createComputations1to4 | 11.7117 |
| @vue/reactivity | s | createComputations1to8 | 10.5063 |
| @vue/reactivity | s | createComputations1to1000 | 9.9950 |
| @vue/reactivity | s | updateComputations1to1 | 22.6068 |
| @vue/reactivity | s | updateComputations2to1 | 15.4859 |
| @vue/reactivity | s | updateComputations4to1 | 10.8445 |
| @vue/reactivity | s | updateComputations1000to1 | 7.0030 |
| @vue/reactivity | s | updateComputations1to2 | 18.5933 |
| @vue/reactivity | s | updateComputations1to4 | 17.9684 |
| @vue/reactivity | s | updateComputations1to1000 | 16.8071 |
| @vue/reactivity | dynamic | 10x5 - 2 sources - read 20% (simple component) | 319.4110 |
| @vue/reactivity | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 227.8458 |
| @vue/reactivity | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 390.7796 |
| @vue/reactivity | dynamic | 1000x5 - 25 sources (wide dense) | 642.8007 |
| @vue/reactivity | dynamic | 5x500 - 3 sources (deep) | 204.3446 |
| @vue/reactivity | cellx | cellx10 | 0.1015 |
| @vue/reactivity | cellx | cellx20 | 0.1135 |
| @vue/reactivity | cellx | cellx30 | 0.0801 |
| frameact | kairo | avoidablePropagation | 150.9258 |
| frameact | kairo | broadPropagation | 335.5780 |
| frameact | kairo | deepPropagation | 124.0060 |
| frameact | kairo | diamond | 202.9614 |
| frameact | kairo | mux | 316.0757 |
| frameact | kairo | repeatedObservers | 18.6623 |
| frameact | kairo | triangle | 70.5350 |
| frameact | kairo | unstable | 39.7491 |
| frameact | mol | molBench | 478.4135 |
| frameact | s | createDataSignals | 8.4035 |
| frameact | s | createComputations0to1 | 7.8672 |
| frameact | s | createComputations1to1 | 16.7602 |
| frameact | s | createComputations2to1 | 13.5328 |
| frameact | s | createComputations4to1 | 11.8292 |
| frameact | s | createComputations1000to1 | 9.9139 |
| frameact | s | createComputations1to2 | 14.0727 |
| frameact | s | createComputations1to4 | 12.9217 |
| frameact | s | createComputations1to8 | 12.2978 |
| frameact | s | createComputations1to1000 | 11.8355 |
| frameact | s | updateComputations1to1 | 25.0579 |
| frameact | s | updateComputations2to1 | 17.2651 |
| frameact | s | updateComputations4to1 | 10.8328 |
| frameact | s | updateComputations1000to1 | 4.5610 |
| frameact | s | updateComputations1to2 | 24.0089 |
| frameact | s | updateComputations1to4 | 20.8166 |
| frameact | s | updateComputations1to1000 | 19.8873 |
| frameact | dynamic | 10x5 - 2 sources - read 20% (simple component) | 274.4305 |
| frameact | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 207.5766 |
| frameact | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 322.5152 |
| frameact | dynamic | 1000x5 - 25 sources (wide dense) | 501.7251 |
| frameact | dynamic | 5x500 - 3 sources (deep) | 155.3640 |
| frameact | cellx | cellx10 | 0.0844 |
| frameact | cellx | cellx20 | 0.1527 |
| frameact | cellx | cellx30 | 0.1216 |
