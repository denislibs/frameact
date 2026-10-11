# Benchmark snapshot

2026-10-11T20:50:50.694Z → 2026-10-11T20:59:11.066Z

**passed** · full · observed graphs · CellX standard

v24.3.0 · Apple M1 Pro · darwin arm64

544 measurements; 0 failed suites. Times are milliseconds. Each framework/suite runs in a fresh process; values are the minimum of 3 samples. Explicit GC is outside timing. Raw samples are in the adjacent JSON file. See the repository README for workload definitions and limitations.

## Comparison by workload family

Geometric mean of each case's time divided by the fastest engine on that case. Lower is better; 1× means fastest on every case in that family. Cases have equal weight within a family. There is no overall score. Small CellX timings are particularly sensitive to noise.

| Engine | kairo | mol | s | dynamic | cellx |
| --- | ---: | ---: | ---: | ---: | ---: |
| alien-signals | 1.02× | 1.25× | 1.02× | 1.00× | 1.00× |
| @angular/signals | 3.19× | 1.31× | 2.46× | 2.98× | 3.03× |
| MobX | 3.74× | 1.30× | 3.64× | 2.64× | 4.53× |
| $mol_wire | 4.06× | 1.00× | 3.95× | 2.16× | 2.03× |
| Oby | 2.23× | 1.51× | 3.43× | 1.98× | 2.83× |
| Pota | 2.97× | 1.51× | 2.75× | 2.02× | 1.31× |
| x-reactivity | 3.59× | 1.53× | 2.92× | 2.79× | 3.10× |
| Preact Signals | 1.21× | 1.25× | 1.24× | 1.29× | 2.75× |
| TC39 Signals Polyfill | 6.81× | 1.33× | 4.00× | 11.38× | 2.67× |
| SolidJS | 3.84× | 1.52× | 2.73× | 3.42× | 1.81× |
| Svelte v5 | 4.09× | 1.28× | 2.79× | 2.19× | 127.90× |
| @amadeus-it-group/tansu | 2.98× | 1.27× | 2.62× | 1.95× | 2.43× |
| @tldraw/state | 3.66× | 1.30× | 2.50× | 5.43× | 5.45× |
| uSignal | 3.15× | 1.74× | 2.31× | 2.39× | 2.72× |
| @vue/reactivity | 2.01× | 1.25× | 1.45× | 1.65× | 2.41× |
| frameact | 3.04× | 1.27× | 2.95× | 2.08× | 2.40× |

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
| alien-signals | kairo | avoidablePropagation | 84.5843 |
| alien-signals | kairo | broadPropagation | 183.1504 |
| alien-signals | kairo | deepPropagation | 67.1801 |
| alien-signals | kairo | diamond | 128.0610 |
| alien-signals | kairo | mux | 202.7709 |
| alien-signals | kairo | repeatedObservers | 14.1032 |
| alien-signals | kairo | triangle | 49.6032 |
| alien-signals | kairo | unstable | 42.6065 |
| alien-signals | mol | molBench | 492.1804 |
| alien-signals | s | createDataSignals | 5.5719 |
| alien-signals | s | createComputations0to1 | 3.7660 |
| alien-signals | s | createComputations1to1 | 10.0658 |
| alien-signals | s | createComputations2to1 | 8.2928 |
| alien-signals | s | createComputations4to1 | 7.6397 |
| alien-signals | s | createComputations1000to1 | 6.6268 |
| alien-signals | s | createComputations1to2 | 7.4615 |
| alien-signals | s | createComputations1to4 | 6.8125 |
| alien-signals | s | createComputations1to8 | 5.8821 |
| alien-signals | s | createComputations1to1000 | 5.6820 |
| alien-signals | s | updateComputations1to1 | 21.3251 |
| alien-signals | s | updateComputations2to1 | 13.4159 |
| alien-signals | s | updateComputations4to1 | 8.9960 |
| alien-signals | s | updateComputations1000to1 | 4.7706 |
| alien-signals | s | updateComputations1to2 | 16.8004 |
| alien-signals | s | updateComputations1to4 | 14.1155 |
| alien-signals | s | updateComputations1to1000 | 13.4037 |
| alien-signals | dynamic | 10x5 - 2 sources - read 20% (simple component) | 173.6758 |
| alien-signals | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 153.3451 |
| alien-signals | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 251.2325 |
| alien-signals | dynamic | 1000x5 - 25 sources (wide dense) | 473.1249 |
| alien-signals | dynamic | 5x500 - 3 sources (deep) | 122.1166 |
| alien-signals | cellx | cellx10 | 0.0428 |
| alien-signals | cellx | cellx20 | 0.0395 |
| alien-signals | cellx | cellx30 | 0.0329 |
| @angular/signals | kairo | avoidablePropagation | 235.9340 |
| @angular/signals | kairo | broadPropagation | 674.1792 |
| @angular/signals | kairo | deepPropagation | 224.9309 |
| @angular/signals | kairo | diamond | 398.0794 |
| @angular/signals | kairo | mux | 549.0747 |
| @angular/signals | kairo | repeatedObservers | 47.8345 |
| @angular/signals | kairo | triangle | 154.0022 |
| @angular/signals | kairo | unstable | 124.2755 |
| @angular/signals | mol | molBench | 515.3132 |
| @angular/signals | s | createDataSignals | 39.5227 |
| @angular/signals | s | createComputations0to1 | 8.7939 |
| @angular/signals | s | createComputations1to1 | 49.0048 |
| @angular/signals | s | createComputations2to1 | 40.4201 |
| @angular/signals | s | createComputations4to1 | 39.2070 |
| @angular/signals | s | createComputations1000to1 | 21.4220 |
| @angular/signals | s | createComputations1to2 | 17.9690 |
| @angular/signals | s | createComputations1to4 | 14.7659 |
| @angular/signals | s | createComputations1to8 | 13.0309 |
| @angular/signals | s | createComputations1to1000 | 10.8895 |
| @angular/signals | s | updateComputations1to1 | 29.6437 |
| @angular/signals | s | updateComputations2to1 | 19.0590 |
| @angular/signals | s | updateComputations4to1 | 12.1326 |
| @angular/signals | s | updateComputations1000to1 | 5.8684 |
| @angular/signals | s | updateComputations1to2 | 28.4884 |
| @angular/signals | s | updateComputations1to4 | 26.7509 |
| @angular/signals | s | updateComputations1to1000 | 27.1671 |
| @angular/signals | dynamic | 10x5 - 2 sources - read 20% (simple component) | 623.3924 |
| @angular/signals | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 447.4459 |
| @angular/signals | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 740.1526 |
| @angular/signals | dynamic | 1000x5 - 25 sources (wide dense) | 1241.1045 |
| @angular/signals | dynamic | 5x500 - 3 sources (deep) | 351.8185 |
| @angular/signals | cellx | cellx10 | 0.0892 |
| @angular/signals | cellx | cellx20 | 0.1177 |
| @angular/signals | cellx | cellx30 | 0.1479 |
| MobX | kairo | avoidablePropagation | 397.7966 |
| MobX | kairo | broadPropagation | 1012.3297 |
| MobX | kairo | deepPropagation | 394.5487 |
| MobX | kairo | diamond | 522.3397 |
| MobX | kairo | mux | 514.6808 |
| MobX | kairo | repeatedObservers | 36.8980 |
| MobX | kairo | triangle | 180.5807 |
| MobX | kairo | unstable | 89.4488 |
| MobX | mol | molBench | 512.7309 |
| MobX | s | createDataSignals | 8.6274 |
| MobX | s | createComputations0to1 | 31.1075 |
| MobX | s | createComputations1to1 | 64.7065 |
| MobX | s | createComputations2to1 | 43.7866 |
| MobX | s | createComputations4to1 | 22.0085 |
| MobX | s | createComputations1000to1 | 10.5708 |
| MobX | s | createComputations1to2 | 57.9865 |
| MobX | s | createComputations1to4 | 52.3375 |
| MobX | s | createComputations1to8 | 47.8055 |
| MobX | s | createComputations1to1000 | 50.3986 |
| MobX | s | updateComputations1to1 | 49.5298 |
| MobX | s | updateComputations2to1 | 28.6469 |
| MobX | s | updateComputations4to1 | 17.6890 |
| MobX | s | updateComputations1000to1 | 6.8270 |
| MobX | s | updateComputations1to2 | 44.7944 |
| MobX | s | updateComputations1to4 | 40.0641 |
| MobX | s | updateComputations1to1000 | 37.1698 |
| MobX | dynamic | 10x5 - 2 sources - read 20% (simple component) | 673.6675 |
| MobX | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 427.8945 |
| MobX | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 582.4524 |
| MobX | dynamic | 1000x5 - 25 sources (wide dense) | 866.2847 |
| MobX | dynamic | 5x500 - 3 sources (deep) | 341.9048 |
| MobX | cellx | cellx10 | 0.1478 |
| MobX | cellx | cellx20 | 0.1183 |
| MobX | cellx | cellx30 | 0.2954 |
| $mol_wire | kairo | avoidablePropagation | 283.1533 |
| $mol_wire | kairo | broadPropagation | 922.3487 |
| $mol_wire | kairo | deepPropagation | 277.0759 |
| $mol_wire | kairo | diamond | 394.4434 |
| $mol_wire | kairo | mux | 648.2245 |
| $mol_wire | kairo | repeatedObservers | 83.0050 |
| $mol_wire | kairo | triangle | 139.3480 |
| $mol_wire | kairo | unstable | 229.7301 |
| $mol_wire | mol | molBench | 393.8118 |
| $mol_wire | s | createDataSignals | 21.3507 |
| $mol_wire | s | createComputations0to1 | 14.9728 |
| $mol_wire | s | createComputations1to1 | 81.5780 |
| $mol_wire | s | createComputations2to1 | 33.2912 |
| $mol_wire | s | createComputations4to1 | 29.3600 |
| $mol_wire | s | createComputations1000to1 | 30.2047 |
| $mol_wire | s | createComputations1to2 | 50.3623 |
| $mol_wire | s | createComputations1to4 | 27.4392 |
| $mol_wire | s | createComputations1to8 | 23.9443 |
| $mol_wire | s | createComputations1to1000 | 20.2063 |
| $mol_wire | s | updateComputations1to1 | 65.9915 |
| $mol_wire | s | updateComputations2to1 | 37.5297 |
| $mol_wire | s | updateComputations4to1 | 23.6982 |
| $mol_wire | s | updateComputations1000to1 | 9.9121 |
| $mol_wire | s | updateComputations1to2 | 57.8177 |
| $mol_wire | s | updateComputations1to4 | 54.8715 |
| $mol_wire | s | updateComputations1to1000 | 62.3342 |
| $mol_wire | dynamic | 10x5 - 2 sources - read 20% (simple component) | 554.2580 |
| $mol_wire | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 326.1809 |
| $mol_wire | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 521.2662 |
| $mol_wire | dynamic | 1000x5 - 25 sources (wide dense) | 713.0210 |
| $mol_wire | dynamic | 5x500 - 3 sources (deep) | 272.2640 |
| $mol_wire | cellx | cellx10 | 0.0795 |
| $mol_wire | cellx | cellx20 | 0.0654 |
| $mol_wire | cellx | cellx30 | 0.0895 |
| Oby | kairo | avoidablePropagation | 207.2706 |
| Oby | kairo | broadPropagation | 437.0873 |
| Oby | kairo | deepPropagation | 202.9935 |
| Oby | kairo | diamond | 267.7233 |
| Oby | kairo | mux | 362.2531 |
| Oby | kairo | repeatedObservers | 33.7280 |
| Oby | kairo | triangle | 125.8356 |
| Oby | kairo | unstable | 54.7089 |
| Oby | mol | molBench | 593.4458 |
| Oby | s | createDataSignals | 10.9457 |
| Oby | s | createComputations0to1 | 29.9920 |
| Oby | s | createComputations1to1 | 75.0098 |
| Oby | s | createComputations2to1 | 46.1923 |
| Oby | s | createComputations4to1 | 21.4183 |
| Oby | s | createComputations1000to1 | 13.7035 |
| Oby | s | createComputations1to2 | 46.4778 |
| Oby | s | createComputations1to4 | 43.5669 |
| Oby | s | createComputations1to8 | 40.2352 |
| Oby | s | createComputations1to1000 | 37.5398 |
| Oby | s | updateComputations1to1 | 38.5886 |
| Oby | s | updateComputations2to1 | 24.1597 |
| Oby | s | updateComputations4to1 | 14.5952 |
| Oby | s | updateComputations1000to1 | 10.1450 |
| Oby | s | updateComputations1to2 | 36.1837 |
| Oby | s | updateComputations1to4 | 32.3517 |
| Oby | s | updateComputations1to1000 | 31.7113 |
| Oby | dynamic | 10x5 - 2 sources - read 20% (simple component) | 414.0857 |
| Oby | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 329.6668 |
| Oby | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 505.1545 |
| Oby | dynamic | 1000x5 - 25 sources (wide dense) | 673.4158 |
| Oby | dynamic | 5x500 - 3 sources (deep) | 255.6125 |
| Oby | cellx | cellx10 | 0.1002 |
| Oby | cellx | cellx20 | 0.0648 |
| Oby | cellx | cellx30 | 0.1940 |
| Pota | kairo | avoidablePropagation | 355.1900 |
| Pota | kairo | broadPropagation | 553.0314 |
| Pota | kairo | deepPropagation | 219.7304 |
| Pota | kairo | diamond | 335.7385 |
| Pota | kairo | mux | 363.6834 |
| Pota | kairo | repeatedObservers | 73.2036 |
| Pota | kairo | triangle | 107.5248 |
| Pota | kairo | unstable | 98.9287 |
| Pota | mol | molBench | 595.1872 |
| Pota | s | createDataSignals | 9.8052 |
| Pota | s | createComputations0to1 | 8.8601 |
| Pota | s | createComputations1to1 | 49.1097 |
| Pota | s | createComputations2to1 | 45.3205 |
| Pota | s | createComputations4to1 | 14.1167 |
| Pota | s | createComputations1000to1 | 11.4434 |
| Pota | s | createComputations1to2 | 44.5372 |
| Pota | s | createComputations1to4 | 15.3306 |
| Pota | s | createComputations1to8 | 13.7006 |
| Pota | s | createComputations1to1000 | 11.7427 |
| Pota | s | updateComputations1to1 | 65.3815 |
| Pota | s | updateComputations2to1 | 38.0953 |
| Pota | s | updateComputations4to1 | 22.9375 |
| Pota | s | updateComputations1000to1 | 9.5111 |
| Pota | s | updateComputations1to2 | 49.5988 |
| Pota | s | updateComputations1to4 | 40.1657 |
| Pota | s | updateComputations1to1000 | 32.7978 |
| Pota | dynamic | 10x5 - 2 sources - read 20% (simple component) | 567.3432 |
| Pota | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 323.1107 |
| Pota | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 419.2175 |
| Pota | dynamic | 1000x5 - 25 sources (wide dense) | 659.0698 |
| Pota | dynamic | 5x500 - 3 sources (deep) | 258.2982 |
| Pota | cellx | cellx10 | 0.0604 |
| Pota | cellx | cellx20 | 0.0571 |
| Pota | cellx | cellx30 | 0.0362 |
| x-reactivity | kairo | avoidablePropagation | 372.3410 |
| x-reactivity | kairo | broadPropagation | 748.7783 |
| x-reactivity | kairo | deepPropagation | 246.3604 |
| x-reactivity | kairo | diamond | 481.9828 |
| x-reactivity | kairo | mux | 287.8819 |
| x-reactivity | kairo | repeatedObservers | 82.8110 |
| x-reactivity | kairo | triangle | 172.3878 |
| x-reactivity | kairo | unstable | 135.8922 |
| x-reactivity | mol | molBench | 602.3866 |
| x-reactivity | s | createDataSignals | 9.2561 |
| x-reactivity | s | createComputations0to1 | 8.5245 |
| x-reactivity | s | createComputations1to1 | 52.1668 |
| x-reactivity | s | createComputations2to1 | 18.3874 |
| x-reactivity | s | createComputations4to1 | 15.1802 |
| x-reactivity | s | createComputations1000to1 | 12.2227 |
| x-reactivity | s | createComputations1to2 | 18.1610 |
| x-reactivity | s | createComputations1to4 | 15.1981 |
| x-reactivity | s | createComputations1to8 | 13.9641 |
| x-reactivity | s | createComputations1to1000 | 12.3892 |
| x-reactivity | s | updateComputations1to1 | 112.8543 |
| x-reactivity | s | updateComputations2to1 | 68.7704 |
| x-reactivity | s | updateComputations4to1 | 38.9815 |
| x-reactivity | s | updateComputations1000to1 | 10.7447 |
| x-reactivity | s | updateComputations1to2 | 77.3074 |
| x-reactivity | s | updateComputations1to4 | 52.3546 |
| x-reactivity | s | updateComputations1to1000 | 38.5836 |
| x-reactivity | dynamic | 10x5 - 2 sources - read 20% (simple component) | 1408.5121 |
| x-reactivity | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 403.0929 |
| x-reactivity | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 532.2301 |
| x-reactivity | dynamic | 1000x5 - 25 sources (wide dense) | 811.9133 |
| x-reactivity | dynamic | 5x500 - 3 sources (deep) | 268.1435 |
| x-reactivity | cellx | cellx10 | 0.1565 |
| x-reactivity | cellx | cellx20 | 0.1385 |
| x-reactivity | cellx | cellx30 | 0.0765 |
| Preact Signals | kairo | avoidablePropagation | 103.1142 |
| Preact Signals | kairo | broadPropagation | 206.3141 |
| Preact Signals | kairo | deepPropagation | 101.0062 |
| Preact Signals | kairo | diamond | 168.8849 |
| Preact Signals | kairo | mux | 228.5575 |
| Preact Signals | kairo | repeatedObservers | 15.7640 |
| Preact Signals | kairo | triangle | 64.3417 |
| Preact Signals | kairo | unstable | 35.5403 |
| Preact Signals | mol | molBench | 491.3100 |
| Preact Signals | s | createDataSignals | 6.6088 |
| Preact Signals | s | createComputations0to1 | 5.5618 |
| Preact Signals | s | createComputations1to1 | 18.1321 |
| Preact Signals | s | createComputations2to1 | 12.3552 |
| Preact Signals | s | createComputations4to1 | 7.6916 |
| Preact Signals | s | createComputations1000to1 | 8.6178 |
| Preact Signals | s | createComputations1to2 | 12.2133 |
| Preact Signals | s | createComputations1to4 | 11.2775 |
| Preact Signals | s | createComputations1to8 | 10.5719 |
| Preact Signals | s | createComputations1to1000 | 5.1396 |
| Preact Signals | s | updateComputations1to1 | 21.4817 |
| Preact Signals | s | updateComputations2to1 | 14.0929 |
| Preact Signals | s | updateComputations4to1 | 9.2562 |
| Preact Signals | s | updateComputations1000to1 | 5.5000 |
| Preact Signals | s | updateComputations1to2 | 15.6385 |
| Preact Signals | s | updateComputations1to4 | 14.0735 |
| Preact Signals | s | updateComputations1to1000 | 11.7363 |
| Preact Signals | dynamic | 10x5 - 2 sources - read 20% (simple component) | 247.9759 |
| Preact Signals | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 205.1503 |
| Preact Signals | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 322.7957 |
| Preact Signals | dynamic | 1000x5 - 25 sources (wide dense) | 499.4931 |
| Preact Signals | dynamic | 5x500 - 3 sources (deep) | 166.3981 |
| Preact Signals | cellx | cellx10 | 0.0721 |
| Preact Signals | cellx | cellx20 | 0.0959 |
| Preact Signals | cellx | cellx30 | 0.1665 |
| TC39 Signals Polyfill | kairo | avoidablePropagation | 330.8293 |
| TC39 Signals Polyfill | kairo | broadPropagation | 1160.7329 |
| TC39 Signals Polyfill | kairo | deepPropagation | 356.4361 |
| TC39 Signals Polyfill | kairo | diamond | 633.3104 |
| TC39 Signals Polyfill | kairo | mux | 915.4383 |
| TC39 Signals Polyfill | kairo | repeatedObservers | 215.9993 |
| TC39 Signals Polyfill | kairo | triangle | 263.9808 |
| TC39 Signals Polyfill | kairo | unstable | 689.5252 |
| TC39 Signals Polyfill | mol | molBench | 523.1451 |
| TC39 Signals Polyfill | s | createDataSignals | 22.6110 |
| TC39 Signals Polyfill | s | createComputations0to1 | 26.4573 |
| TC39 Signals Polyfill | s | createComputations1to1 | 70.3037 |
| TC39 Signals Polyfill | s | createComputations2to1 | 42.4065 |
| TC39 Signals Polyfill | s | createComputations4to1 | 31.0248 |
| TC39 Signals Polyfill | s | createComputations1000to1 | 24.3252 |
| TC39 Signals Polyfill | s | createComputations1to2 | 51.4470 |
| TC39 Signals Polyfill | s | createComputations1to4 | 45.4190 |
| TC39 Signals Polyfill | s | createComputations1to8 | 41.4793 |
| TC39 Signals Polyfill | s | createComputations1to1000 | 36.4547 |
| TC39 Signals Polyfill | s | updateComputations1to1 | 50.7916 |
| TC39 Signals Polyfill | s | updateComputations2to1 | 31.0536 |
| TC39 Signals Polyfill | s | updateComputations4to1 | 19.9530 |
| TC39 Signals Polyfill | s | updateComputations1000to1 | 8.7057 |
| TC39 Signals Polyfill | s | updateComputations1to2 | 43.9277 |
| TC39 Signals Polyfill | s | updateComputations1to4 | 38.5570 |
| TC39 Signals Polyfill | s | updateComputations1to1000 | 33.2376 |
| TC39 Signals Polyfill | dynamic | 10x5 - 2 sources - read 20% (simple component) | 1816.5293 |
| TC39 Signals Polyfill | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 689.7165 |
| TC39 Signals Polyfill | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 12882.4299 |
| TC39 Signals Polyfill | dynamic | 1000x5 - 25 sources (wide dense) | 9129.9514 |
| TC39 Signals Polyfill | dynamic | 5x500 - 3 sources (deep) | 499.9836 |
| TC39 Signals Polyfill | cellx | cellx10 | 0.1149 |
| TC39 Signals Polyfill | cellx | cellx20 | 0.0962 |
| TC39 Signals Polyfill | cellx | cellx30 | 0.0963 |
| SolidJS | kairo | avoidablePropagation | 363.9572 |
| SolidJS | kairo | broadPropagation | 833.7221 |
| SolidJS | kairo | deepPropagation | 347.8388 |
| SolidJS | kairo | diamond | 516.0916 |
| SolidJS | kairo | mux | 481.4140 |
| SolidJS | kairo | repeatedObservers | 67.5330 |
| SolidJS | kairo | triangle | 171.2475 |
| SolidJS | kairo | unstable | 103.8442 |
| SolidJS | mol | molBench | 597.0275 |
| SolidJS | s | createDataSignals | 8.1825 |
| SolidJS | s | createComputations0to1 | 8.1528 |
| SolidJS | s | createComputations1to1 | 44.7050 |
| SolidJS | s | createComputations2to1 | 41.0075 |
| SolidJS | s | createComputations4to1 | 12.3945 |
| SolidJS | s | createComputations1000to1 | 9.3360 |
| SolidJS | s | createComputations1to2 | 18.7109 |
| SolidJS | s | createComputations1to4 | 13.0663 |
| SolidJS | s | createComputations1to8 | 11.3503 |
| SolidJS | s | createComputations1to1000 | 10.5391 |
| SolidJS | s | updateComputations1to1 | 70.1179 |
| SolidJS | s | updateComputations2to1 | 49.3976 |
| SolidJS | s | updateComputations4to1 | 36.8600 |
| SolidJS | s | updateComputations1000to1 | 27.0166 |
| SolidJS | s | updateComputations1to2 | 46.4712 |
| SolidJS | s | updateComputations1to4 | 42.0693 |
| SolidJS | s | updateComputations1to1000 | 38.8338 |
| SolidJS | dynamic | 10x5 - 2 sources - read 20% (simple component) | 1424.5544 |
| SolidJS | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 530.6928 |
| SolidJS | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 615.7945 |
| SolidJS | dynamic | 1000x5 - 25 sources (wide dense) | 1111.3543 |
| SolidJS | dynamic | 5x500 - 3 sources (deep) | 351.5755 |
| SolidJS | cellx | cellx10 | 0.0695 |
| SolidJS | cellx | cellx20 | 0.0778 |
| SolidJS | cellx | cellx30 | 0.0607 |
| Svelte v5 | kairo | avoidablePropagation | 554.9112 |
| Svelte v5 | kairo | broadPropagation | 825.6486 |
| Svelte v5 | kairo | deepPropagation | 373.0833 |
| Svelte v5 | kairo | diamond | 574.6728 |
| Svelte v5 | kairo | mux | 329.5379 |
| Svelte v5 | kairo | repeatedObservers | 72.0584 |
| Svelte v5 | kairo | triangle | 193.5593 |
| Svelte v5 | kairo | unstable | 115.7061 |
| Svelte v5 | mol | molBench | 504.4646 |
| Svelte v5 | s | createDataSignals | 6.4470 |
| Svelte v5 | s | createComputations0to1 | 17.7804 |
| Svelte v5 | s | createComputations1to1 | 28.6865 |
| Svelte v5 | s | createComputations2to1 | 16.0493 |
| Svelte v5 | s | createComputations4to1 | 11.3014 |
| Svelte v5 | s | createComputations1000to1 | 6.4417 |
| Svelte v5 | s | createComputations1to2 | 21.5827 |
| Svelte v5 | s | createComputations1to4 | 18.6073 |
| Svelte v5 | s | createComputations1to8 | 17.9659 |
| Svelte v5 | s | createComputations1to1000 | 18.0176 |
| Svelte v5 | s | updateComputations1to1 | 152.1187 |
| Svelte v5 | s | updateComputations2to1 | 77.9137 |
| Svelte v5 | s | updateComputations4to1 | 41.8641 |
| Svelte v5 | s | updateComputations1000to1 | 4.9148 |
| Svelte v5 | s | updateComputations1to2 | 88.7344 |
| Svelte v5 | s | updateComputations1to4 | 57.3973 |
| Svelte v5 | s | updateComputations1to1000 | 25.3013 |
| Svelte v5 | dynamic | 10x5 - 2 sources - read 20% (simple component) | 747.4680 |
| Svelte v5 | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 327.8975 |
| Svelte v5 | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 523.2292 |
| Svelte v5 | dynamic | 1000x5 - 25 sources (wide dense) | 561.2329 |
| Svelte v5 | dynamic | 5x500 - 3 sources (deep) | 267.9764 |
| Svelte v5 | cellx | cellx10 | 0.1343 |
| Svelte v5 | cellx | cellx20 | 2.7331 |
| Svelte v5 | cellx | cellx30 | 317.0331 |
| @amadeus-it-group/tansu | kairo | avoidablePropagation | 265.5635 |
| @amadeus-it-group/tansu | kairo | broadPropagation | 679.2466 |
| @amadeus-it-group/tansu | kairo | deepPropagation | 212.1023 |
| @amadeus-it-group/tansu | kairo | diamond | 298.5903 |
| @amadeus-it-group/tansu | kairo | mux | 481.1663 |
| @amadeus-it-group/tansu | kairo | repeatedObservers | 55.5943 |
| @amadeus-it-group/tansu | kairo | triangle | 103.0630 |
| @amadeus-it-group/tansu | kairo | unstable | 131.0855 |
| @amadeus-it-group/tansu | mol | molBench | 498.3885 |
| @amadeus-it-group/tansu | s | createDataSignals | 10.9848 |
| @amadeus-it-group/tansu | s | createComputations0to1 | 11.0265 |
| @amadeus-it-group/tansu | s | createComputations1to1 | 48.4123 |
| @amadeus-it-group/tansu | s | createComputations2to1 | 26.6138 |
| @amadeus-it-group/tansu | s | createComputations4to1 | 15.7895 |
| @amadeus-it-group/tansu | s | createComputations1000to1 | 14.0920 |
| @amadeus-it-group/tansu | s | createComputations1to2 | 26.3352 |
| @amadeus-it-group/tansu | s | createComputations1to4 | 25.0615 |
| @amadeus-it-group/tansu | s | createComputations1to8 | 22.4820 |
| @amadeus-it-group/tansu | s | createComputations1to1000 | 20.7740 |
| @amadeus-it-group/tansu | s | updateComputations1to1 | 38.9043 |
| @amadeus-it-group/tansu | s | updateComputations2to1 | 23.7592 |
| @amadeus-it-group/tansu | s | updateComputations4to1 | 15.0161 |
| @amadeus-it-group/tansu | s | updateComputations1000to1 | 9.8878 |
| @amadeus-it-group/tansu | s | updateComputations1to2 | 34.2933 |
| @amadeus-it-group/tansu | s | updateComputations1to4 | 32.7321 |
| @amadeus-it-group/tansu | s | updateComputations1to1000 | 33.7379 |
| @amadeus-it-group/tansu | dynamic | 10x5 - 2 sources - read 20% (simple component) | 456.4298 |
| @amadeus-it-group/tansu | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 287.2917 |
| @amadeus-it-group/tansu | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 532.9558 |
| @amadeus-it-group/tansu | dynamic | 1000x5 - 25 sources (wide dense) | 655.3500 |
| @amadeus-it-group/tansu | dynamic | 5x500 - 3 sources (deep) | 235.8152 |
| @amadeus-it-group/tansu | cellx | cellx10 | 0.1057 |
| @amadeus-it-group/tansu | cellx | cellx20 | 0.0780 |
| @amadeus-it-group/tansu | cellx | cellx30 | 0.0964 |
| @tldraw/state | kairo | avoidablePropagation | 339.5517 |
| @tldraw/state | kairo | broadPropagation | 849.5861 |
| @tldraw/state | kairo | deepPropagation | 276.4809 |
| @tldraw/state | kairo | diamond | 446.6098 |
| @tldraw/state | kairo | mux | 615.9289 |
| @tldraw/state | kairo | repeatedObservers | 56.0527 |
| @tldraw/state | kairo | triangle | 191.7312 |
| @tldraw/state | kairo | unstable | 92.2082 |
| @tldraw/state | mol | molBench | 510.0435 |
| @tldraw/state | s | createDataSignals | 8.1807 |
| @tldraw/state | s | createComputations0to1 | 7.0420 |
| @tldraw/state | s | createComputations1to1 | 19.3259 |
| @tldraw/state | s | createComputations2to1 | 17.1750 |
| @tldraw/state | s | createComputations4to1 | 10.4407 |
| @tldraw/state | s | createComputations1000to1 | 13.1208 |
| @tldraw/state | s | createComputations1to2 | 18.8939 |
| @tldraw/state | s | createComputations1to4 | 15.8905 |
| @tldraw/state | s | createComputations1to8 | 14.7672 |
| @tldraw/state | s | createComputations1to1000 | 13.8687 |
| @tldraw/state | s | updateComputations1to1 | 67.0934 |
| @tldraw/state | s | updateComputations2to1 | 40.2764 |
| @tldraw/state | s | updateComputations4to1 | 27.5460 |
| @tldraw/state | s | updateComputations1000to1 | 20.7609 |
| @tldraw/state | s | updateComputations1to2 | 55.3490 |
| @tldraw/state | s | updateComputations1to4 | 46.4762 |
| @tldraw/state | s | updateComputations1to1000 | 39.4234 |
| @tldraw/state | dynamic | 10x5 - 2 sources - read 20% (simple component) | 711.7830 |
| @tldraw/state | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 445.9561 |
| @tldraw/state | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 4837.0371 |
| @tldraw/state | dynamic | 1000x5 - 25 sources (wide dense) | 3878.8724 |
| @tldraw/state | dynamic | 5x500 - 3 sources (deep) | 307.2328 |
| @tldraw/state | cellx | cellx10 | 0.1318 |
| @tldraw/state | cellx | cellx20 | 0.2180 |
| @tldraw/state | cellx | cellx30 | 0.3137 |
| uSignal | kairo | avoidablePropagation | 492.1572 |
| uSignal | kairo | broadPropagation | 677.1225 |
| uSignal | kairo | deepPropagation | 207.3343 |
| uSignal | kairo | diamond | 341.8244 |
| uSignal | kairo | mux | 613.4357 |
| uSignal | kairo | repeatedObservers | 48.7592 |
| uSignal | kairo | triangle | 141.0688 |
| uSignal | kairo | unstable | 66.1384 |
| uSignal | mol | molBench | 684.9906 |
| uSignal | s | createDataSignals | 8.2785 |
| uSignal | s | createComputations0to1 | 7.5551 |
| uSignal | s | createComputations1to1 | 34.7204 |
| uSignal | s | createComputations2to1 | 16.9527 |
| uSignal | s | createComputations4to1 | 15.8443 |
| uSignal | s | createComputations1000to1 | 12.7253 |
| uSignal | s | createComputations1to2 | 22.8790 |
| uSignal | s | createComputations1to4 | 20.9300 |
| uSignal | s | createComputations1to8 | 21.1628 |
| uSignal | s | createComputations1to1000 | 13.5371 |
| uSignal | s | updateComputations1to1 | 37.1425 |
| uSignal | s | updateComputations2to1 | 23.7830 |
| uSignal | s | updateComputations4to1 | 15.9533 |
| uSignal | s | updateComputations1000to1 | 14.2595 |
| uSignal | s | updateComputations1to2 | 31.4776 |
| uSignal | s | updateComputations1to4 | 28.1638 |
| uSignal | s | updateComputations1to1000 | 35.0895 |
| uSignal | dynamic | 10x5 - 2 sources - read 20% (simple component) | 450.7644 |
| uSignal | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 417.5893 |
| uSignal | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 494.8292 |
| uSignal | dynamic | 1000x5 - 25 sources (wide dense) | 1150.0643 |
| uSignal | dynamic | 5x500 - 3 sources (deep) | 283.0729 |
| uSignal | cellx | cellx10 | 0.0648 |
| uSignal | cellx | cellx20 | 0.0995 |
| uSignal | cellx | cellx30 | 0.1728 |
| @vue/reactivity | kairo | avoidablePropagation | 220.9900 |
| @vue/reactivity | kairo | broadPropagation | 459.0550 |
| @vue/reactivity | kairo | deepPropagation | 147.1228 |
| @vue/reactivity | kairo | diamond | 228.4461 |
| @vue/reactivity | kairo | mux | 420.7693 |
| @vue/reactivity | kairo | repeatedObservers | 25.4990 |
| @vue/reactivity | kairo | triangle | 79.3975 |
| @vue/reactivity | kairo | unstable | 61.1532 |
| @vue/reactivity | mol | molBench | 492.0048 |
| @vue/reactivity | s | createDataSignals | 7.9275 |
| @vue/reactivity | s | createComputations0to1 | 6.1209 |
| @vue/reactivity | s | createComputations1to1 | 16.3281 |
| @vue/reactivity | s | createComputations2to1 | 10.8640 |
| @vue/reactivity | s | createComputations4to1 | 10.2865 |
| @vue/reactivity | s | createComputations1000to1 | 10.7089 |
| @vue/reactivity | s | createComputations1to2 | 13.0433 |
| @vue/reactivity | s | createComputations1to4 | 11.7830 |
| @vue/reactivity | s | createComputations1to8 | 10.7944 |
| @vue/reactivity | s | createComputations1to1000 | 10.2712 |
| @vue/reactivity | s | updateComputations1to1 | 22.9057 |
| @vue/reactivity | s | updateComputations2to1 | 15.4381 |
| @vue/reactivity | s | updateComputations4to1 | 10.8413 |
| @vue/reactivity | s | updateComputations1000to1 | 7.0556 |
| @vue/reactivity | s | updateComputations1to2 | 18.1167 |
| @vue/reactivity | s | updateComputations1to4 | 17.7338 |
| @vue/reactivity | s | updateComputations1to1000 | 16.6228 |
| @vue/reactivity | dynamic | 10x5 - 2 sources - read 20% (simple component) | 332.4671 |
| @vue/reactivity | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 237.8336 |
| @vue/reactivity | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 412.1705 |
| @vue/reactivity | dynamic | 1000x5 - 25 sources (wide dense) | 672.0092 |
| @vue/reactivity | dynamic | 5x500 - 3 sources (deep) | 218.6888 |
| @vue/reactivity | cellx | cellx10 | 0.1010 |
| @vue/reactivity | cellx | cellx20 | 0.0833 |
| @vue/reactivity | cellx | cellx30 | 0.0920 |
| frameact | kairo | avoidablePropagation | 384.2554 |
| frameact | kairo | broadPropagation | 466.2121 |
| frameact | kairo | deepPropagation | 211.1142 |
| frameact | kairo | diamond | 316.6590 |
| frameact | kairo | mux | 389.2225 |
| frameact | kairo | repeatedObservers | 59.7486 |
| frameact | kairo | triangle | 111.9158 |
| frameact | kairo | unstable | 157.2861 |
| frameact | mol | molBench | 499.1670 |
| frameact | s | createDataSignals | 14.9983 |
| frameact | s | createComputations0to1 | 9.2770 |
| frameact | s | createComputations1to1 | 59.1478 |
| frameact | s | createComputations2to1 | 69.7450 |
| frameact | s | createComputations4to1 | 68.8230 |
| frameact | s | createComputations1000to1 | 16.4735 |
| frameact | s | createComputations1to2 | 30.5760 |
| frameact | s | createComputations1to4 | 17.6845 |
| frameact | s | createComputations1to8 | 16.9175 |
| frameact | s | createComputations1to1000 | 16.1712 |
| frameact | s | updateComputations1to1 | 48.7406 |
| frameact | s | updateComputations2to1 | 30.1009 |
| frameact | s | updateComputations4to1 | 17.9499 |
| frameact | s | updateComputations1000to1 | 6.6678 |
| frameact | s | updateComputations1to2 | 37.1483 |
| frameact | s | updateComputations1to4 | 29.5693 |
| frameact | s | updateComputations1to1000 | 22.5623 |
| frameact | dynamic | 10x5 - 2 sources - read 20% (simple component) | 467.8748 |
| frameact | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 328.7998 |
| frameact | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 503.1644 |
| frameact | dynamic | 1000x5 - 25 sources (wide dense) | 728.2482 |
| frameact | dynamic | 5x500 - 3 sources (deep) | 265.6057 |
| frameact | cellx | cellx10 | 0.0991 |
| frameact | cellx | cellx20 | 0.1022 |
| frameact | cellx | cellx30 | 0.0763 |
