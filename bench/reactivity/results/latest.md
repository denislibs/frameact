# Benchmark snapshot

2026-10-11T20:00:38.321Z → 2026-10-11T20:09:07.223Z

**passed** · full · observed graphs · CellX standard

v24.3.0 · Apple M1 Pro · darwin arm64

544 measurements; 0 failed suites. Times are milliseconds. Each framework/suite runs in a fresh process; values are the minimum of 3 samples. Explicit GC is outside timing. Raw samples are in the adjacent JSON file. See the repository README for workload definitions and limitations.

## Comparison by workload family

Geometric mean of each case's time divided by the fastest engine on that case. Lower is better; 1× means fastest on every case in that family. Cases have equal weight within a family. There is no overall score. Small CellX timings are particularly sensitive to noise.

| Engine | kairo | mol | s | dynamic | cellx |
| --- | ---: | ---: | ---: | ---: | ---: |
| alien-signals | 1.01× | 1.29× | 1.01× | 1.00× | 1.08× |
| @angular/signals | 3.28× | 1.33× | 2.48× | 2.93× | 1.96× |
| MobX | 3.67× | 1.34× | 3.62× | 2.63× | 4.40× |
| $mol_wire | 4.05× | 1.00× | 4.09× | 2.16× | 1.80× |
| Oby | 2.18× | 1.58× | 3.20× | 1.99× | 3.33× |
| Pota | 3.03× | 1.57× | 2.69× | 2.01× | 1.50× |
| x-reactivity | 3.58× | 1.59× | 2.86× | 2.80× | 2.62× |
| Preact Signals | 1.22× | 1.28× | 1.32× | 1.35× | 1.23× |
| TC39 Signals Polyfill | 6.86× | 1.38× | 3.93× | 11.58× | 2.69× |
| SolidJS | 3.84× | 1.57× | 2.68× | 3.45× | 1.70× |
| Svelte v5 | 4.07× | 1.34× | 2.77× | 2.23× | 128.33× |
| @amadeus-it-group/tansu | 3.01× | 1.33× | 2.57× | 1.98× | 2.22× |
| @tldraw/state | 3.72× | 1.35× | 2.54× | 5.87× | 4.07× |
| uSignal | 3.27× | 1.84× | 2.38× | 2.51× | 2.08× |
| @vue/reactivity | 2.09× | 1.32× | 1.54× | 1.74× | 2.33× |
| frameact | 2.68× | 1.31× | 2.89× | 1.97× | 2.69× |

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
| alien-signals | kairo | avoidablePropagation | 84.5483 |
| alien-signals | kairo | broadPropagation | 184.9249 |
| alien-signals | kairo | deepPropagation | 67.7393 |
| alien-signals | kairo | diamond | 128.9323 |
| alien-signals | kairo | mux | 195.3026 |
| alien-signals | kairo | repeatedObservers | 13.9840 |
| alien-signals | kairo | triangle | 49.8303 |
| alien-signals | kairo | unstable | 40.3448 |
| alien-signals | mol | molBench | 491.5031 |
| alien-signals | s | createDataSignals | 5.4432 |
| alien-signals | s | createComputations0to1 | 3.8136 |
| alien-signals | s | createComputations1to1 | 10.9844 |
| alien-signals | s | createComputations2to1 | 8.7498 |
| alien-signals | s | createComputations4to1 | 8.0388 |
| alien-signals | s | createComputations1000to1 | 6.5705 |
| alien-signals | s | createComputations1to2 | 7.7446 |
| alien-signals | s | createComputations1to4 | 6.7634 |
| alien-signals | s | createComputations1to8 | 5.8610 |
| alien-signals | s | createComputations1to1000 | 5.8642 |
| alien-signals | s | updateComputations1to1 | 21.0923 |
| alien-signals | s | updateComputations2to1 | 13.3587 |
| alien-signals | s | updateComputations4to1 | 8.9367 |
| alien-signals | s | updateComputations1000to1 | 4.5818 |
| alien-signals | s | updateComputations1to2 | 16.7186 |
| alien-signals | s | updateComputations1to4 | 14.1343 |
| alien-signals | s | updateComputations1to1000 | 13.3905 |
| alien-signals | dynamic | 10x5 - 2 sources - read 20% (simple component) | 168.4988 |
| alien-signals | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 149.6113 |
| alien-signals | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 259.6810 |
| alien-signals | dynamic | 1000x5 - 25 sources (wide dense) | 472.2780 |
| alien-signals | dynamic | 5x500 - 3 sources (deep) | 123.1947 |
| alien-signals | cellx | cellx10 | 0.0489 |
| alien-signals | cellx | cellx20 | 0.0424 |
| alien-signals | cellx | cellx30 | 0.0433 |
| @angular/signals | kairo | avoidablePropagation | 250.0942 |
| @angular/signals | kairo | broadPropagation | 665.7760 |
| @angular/signals | kairo | deepPropagation | 225.9714 |
| @angular/signals | kairo | diamond | 397.1680 |
| @angular/signals | kairo | mux | 531.7593 |
| @angular/signals | kairo | repeatedObservers | 47.0122 |
| @angular/signals | kairo | triangle | 161.1022 |
| @angular/signals | kairo | unstable | 147.5562 |
| @angular/signals | mol | molBench | 507.8345 |
| @angular/signals | s | createDataSignals | 50.5150 |
| @angular/signals | s | createComputations0to1 | 8.1660 |
| @angular/signals | s | createComputations1to1 | 49.7140 |
| @angular/signals | s | createComputations2to1 | 40.5542 |
| @angular/signals | s | createComputations4to1 | 39.3200 |
| @angular/signals | s | createComputations1000to1 | 20.4015 |
| @angular/signals | s | createComputations1to2 | 18.3577 |
| @angular/signals | s | createComputations1to4 | 15.7200 |
| @angular/signals | s | createComputations1to8 | 13.6658 |
| @angular/signals | s | createComputations1to1000 | 11.8226 |
| @angular/signals | s | updateComputations1to1 | 30.6915 |
| @angular/signals | s | updateComputations2to1 | 19.1529 |
| @angular/signals | s | updateComputations4to1 | 12.5238 |
| @angular/signals | s | updateComputations1000to1 | 5.9431 |
| @angular/signals | s | updateComputations1to2 | 29.6356 |
| @angular/signals | s | updateComputations1to4 | 27.9334 |
| @angular/signals | s | updateComputations1to1000 | 26.3086 |
| @angular/signals | dynamic | 10x5 - 2 sources - read 20% (simple component) | 621.4451 |
| @angular/signals | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 446.9339 |
| @angular/signals | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 728.0856 |
| @angular/signals | dynamic | 1000x5 - 25 sources (wide dense) | 1219.7022 |
| @angular/signals | dynamic | 5x500 - 3 sources (deep) | 333.5952 |
| @angular/signals | cellx | cellx10 | 0.0836 |
| @angular/signals | cellx | cellx20 | 0.0729 |
| @angular/signals | cellx | cellx30 | 0.0883 |
| MobX | kairo | avoidablePropagation | 386.4212 |
| MobX | kairo | broadPropagation | 989.0192 |
| MobX | kairo | deepPropagation | 389.5665 |
| MobX | kairo | diamond | 517.2050 |
| MobX | kairo | mux | 507.6706 |
| MobX | kairo | repeatedObservers | 36.8985 |
| MobX | kairo | triangle | 177.5940 |
| MobX | kairo | unstable | 86.6110 |
| MobX | mol | molBench | 510.8515 |
| MobX | s | createDataSignals | 8.5055 |
| MobX | s | createComputations0to1 | 31.4095 |
| MobX | s | createComputations1to1 | 66.1717 |
| MobX | s | createComputations2to1 | 43.3095 |
| MobX | s | createComputations4to1 | 21.6723 |
| MobX | s | createComputations1000to1 | 14.0976 |
| MobX | s | createComputations1to2 | 57.4627 |
| MobX | s | createComputations1to4 | 51.8842 |
| MobX | s | createComputations1to8 | 47.2414 |
| MobX | s | createComputations1to1000 | 49.0185 |
| MobX | s | updateComputations1to1 | 49.4294 |
| MobX | s | updateComputations2to1 | 29.1095 |
| MobX | s | updateComputations4to1 | 17.7518 |
| MobX | s | updateComputations1000to1 | 7.0121 |
| MobX | s | updateComputations1to2 | 44.0861 |
| MobX | s | updateComputations1to4 | 39.3944 |
| MobX | s | updateComputations1to1000 | 37.1505 |
| MobX | dynamic | 10x5 - 2 sources - read 20% (simple component) | 673.3924 |
| MobX | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 423.4080 |
| MobX | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 585.1569 |
| MobX | dynamic | 1000x5 - 25 sources (wide dense) | 837.7687 |
| MobX | dynamic | 5x500 - 3 sources (deep) | 341.3433 |
| MobX | cellx | cellx10 | 0.1489 |
| MobX | cellx | cellx20 | 0.1380 |
| MobX | cellx | cellx30 | 0.2966 |
| $mol_wire | kairo | avoidablePropagation | 282.5526 |
| $mol_wire | kairo | broadPropagation | 920.9174 |
| $mol_wire | kairo | deepPropagation | 277.8241 |
| $mol_wire | kairo | diamond | 391.5783 |
| $mol_wire | kairo | mux | 631.5967 |
| $mol_wire | kairo | repeatedObservers | 84.3327 |
| $mol_wire | kairo | triangle | 139.9069 |
| $mol_wire | kairo | unstable | 229.3358 |
| $mol_wire | mol | molBench | 382.1342 |
| $mol_wire | s | createDataSignals | 21.1064 |
| $mol_wire | s | createComputations0to1 | 14.9841 |
| $mol_wire | s | createComputations1to1 | 90.7538 |
| $mol_wire | s | createComputations2to1 | 34.9423 |
| $mol_wire | s | createComputations4to1 | 38.5972 |
| $mol_wire | s | createComputations1000to1 | 31.0148 |
| $mol_wire | s | createComputations1to2 | 50.9888 |
| $mol_wire | s | createComputations1to4 | 28.1278 |
| $mol_wire | s | createComputations1to8 | 24.9125 |
| $mol_wire | s | createComputations1to1000 | 21.3284 |
| $mol_wire | s | updateComputations1to1 | 69.6629 |
| $mol_wire | s | updateComputations2to1 | 39.4966 |
| $mol_wire | s | updateComputations4to1 | 24.6754 |
| $mol_wire | s | updateComputations1000to1 | 10.2853 |
| $mol_wire | s | updateComputations1to2 | 61.7550 |
| $mol_wire | s | updateComputations1to4 | 58.4325 |
| $mol_wire | s | updateComputations1to1000 | 64.4012 |
| $mol_wire | dynamic | 10x5 - 2 sources - read 20% (simple component) | 536.0455 |
| $mol_wire | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 327.6713 |
| $mol_wire | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 527.1238 |
| $mol_wire | dynamic | 1000x5 - 25 sources (wide dense) | 704.9316 |
| $mol_wire | dynamic | 5x500 - 3 sources (deep) | 274.5120 |
| $mol_wire | cellx | cellx10 | 0.0716 |
| $mol_wire | cellx | cellx20 | 0.0633 |
| $mol_wire | cellx | cellx30 | 0.0923 |
| Oby | kairo | avoidablePropagation | 202.1311 |
| Oby | kairo | broadPropagation | 439.1460 |
| Oby | kairo | deepPropagation | 190.6720 |
| Oby | kairo | diamond | 252.3098 |
| Oby | kairo | mux | 371.0854 |
| Oby | kairo | repeatedObservers | 34.4027 |
| Oby | kairo | triangle | 116.4559 |
| Oby | kairo | unstable | 54.3285 |
| Oby | mol | molBench | 603.5841 |
| Oby | s | createDataSignals | 11.2309 |
| Oby | s | createComputations0to1 | 28.4977 |
| Oby | s | createComputations1to1 | 67.4557 |
| Oby | s | createComputations2to1 | 47.4115 |
| Oby | s | createComputations4to1 | 19.1936 |
| Oby | s | createComputations1000to1 | 13.3030 |
| Oby | s | createComputations1to2 | 44.5007 |
| Oby | s | createComputations1to4 | 36.7800 |
| Oby | s | createComputations1to8 | 40.5143 |
| Oby | s | createComputations1to1000 | 35.2545 |
| Oby | s | updateComputations1to1 | 36.4003 |
| Oby | s | updateComputations2to1 | 22.7709 |
| Oby | s | updateComputations4to1 | 14.1473 |
| Oby | s | updateComputations1000to1 | 10.1785 |
| Oby | s | updateComputations1to2 | 33.4210 |
| Oby | s | updateComputations1to4 | 31.5285 |
| Oby | s | updateComputations1to1000 | 30.5972 |
| Oby | dynamic | 10x5 - 2 sources - read 20% (simple component) | 412.3334 |
| Oby | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 319.3153 |
| Oby | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 495.9905 |
| Oby | dynamic | 1000x5 - 25 sources (wide dense) | 693.5920 |
| Oby | dynamic | 5x500 - 3 sources (deep) | 263.8312 |
| Oby | cellx | cellx10 | 0.1023 |
| Oby | cellx | cellx20 | 0.1020 |
| Oby | cellx | cellx30 | 0.2519 |
| Pota | kairo | avoidablePropagation | 359.0890 |
| Pota | kairo | broadPropagation | 576.3641 |
| Pota | kairo | deepPropagation | 227.0146 |
| Pota | kairo | diamond | 337.1855 |
| Pota | kairo | mux | 365.7850 |
| Pota | kairo | repeatedObservers | 73.4556 |
| Pota | kairo | triangle | 112.2702 |
| Pota | kairo | unstable | 99.0784 |
| Pota | mol | molBench | 601.0507 |
| Pota | s | createDataSignals | 9.1793 |
| Pota | s | createComputations0to1 | 9.2842 |
| Pota | s | createComputations1to1 | 41.7058 |
| Pota | s | createComputations2to1 | 41.1175 |
| Pota | s | createComputations4to1 | 15.2076 |
| Pota | s | createComputations1000to1 | 11.3768 |
| Pota | s | createComputations1to2 | 45.9308 |
| Pota | s | createComputations1to4 | 15.6740 |
| Pota | s | createComputations1to8 | 14.3105 |
| Pota | s | createComputations1to1000 | 12.2846 |
| Pota | s | updateComputations1to1 | 65.3180 |
| Pota | s | updateComputations2to1 | 38.6138 |
| Pota | s | updateComputations4to1 | 23.2041 |
| Pota | s | updateComputations1000to1 | 9.7183 |
| Pota | s | updateComputations1to2 | 49.2163 |
| Pota | s | updateComputations1to4 | 40.7989 |
| Pota | s | updateComputations1to1000 | 33.8004 |
| Pota | dynamic | 10x5 - 2 sources - read 20% (simple component) | 564.2566 |
| Pota | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 319.9936 |
| Pota | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 416.9483 |
| Pota | dynamic | 1000x5 - 25 sources (wide dense) | 643.8498 |
| Pota | dynamic | 5x500 - 3 sources (deep) | 258.8875 |
| Pota | cellx | cellx10 | 0.0590 |
| Pota | cellx | cellx20 | 0.0654 |
| Pota | cellx | cellx30 | 0.0628 |
| x-reactivity | kairo | avoidablePropagation | 379.8402 |
| x-reactivity | kairo | broadPropagation | 738.8311 |
| x-reactivity | kairo | deepPropagation | 239.8042 |
| x-reactivity | kairo | diamond | 484.4035 |
| x-reactivity | kairo | mux | 287.2130 |
| x-reactivity | kairo | repeatedObservers | 81.7168 |
| x-reactivity | kairo | triangle | 172.2188 |
| x-reactivity | kairo | unstable | 135.8937 |
| x-reactivity | mol | molBench | 606.5977 |
| x-reactivity | s | createDataSignals | 7.9110 |
| x-reactivity | s | createComputations0to1 | 7.9347 |
| x-reactivity | s | createComputations1to1 | 46.8203 |
| x-reactivity | s | createComputations2to1 | 31.9899 |
| x-reactivity | s | createComputations4to1 | 13.0876 |
| x-reactivity | s | createComputations1000to1 | 10.3433 |
| x-reactivity | s | createComputations1to2 | 22.9891 |
| x-reactivity | s | createComputations1to4 | 13.7464 |
| x-reactivity | s | createComputations1to8 | 12.7774 |
| x-reactivity | s | createComputations1to1000 | 11.9730 |
| x-reactivity | s | updateComputations1to1 | 116.8770 |
| x-reactivity | s | updateComputations2to1 | 67.0880 |
| x-reactivity | s | updateComputations4to1 | 39.1440 |
| x-reactivity | s | updateComputations1000to1 | 10.9556 |
| x-reactivity | s | updateComputations1to2 | 75.6687 |
| x-reactivity | s | updateComputations1to4 | 52.1328 |
| x-reactivity | s | updateComputations1to1000 | 42.2215 |
| x-reactivity | dynamic | 10x5 - 2 sources - read 20% (simple component) | 1397.0135 |
| x-reactivity | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 411.1218 |
| x-reactivity | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 529.5415 |
| x-reactivity | dynamic | 1000x5 - 25 sources (wide dense) | 810.7317 |
| x-reactivity | dynamic | 5x500 - 3 sources (deep) | 267.7027 |
| x-reactivity | cellx | cellx10 | 0.1421 |
| x-reactivity | cellx | cellx20 | 0.1146 |
| x-reactivity | cellx | cellx30 | 0.0790 |
| Preact Signals | kairo | avoidablePropagation | 106.4690 |
| Preact Signals | kairo | broadPropagation | 206.7849 |
| Preact Signals | kairo | deepPropagation | 101.7280 |
| Preact Signals | kairo | diamond | 169.6395 |
| Preact Signals | kairo | mux | 242.7062 |
| Preact Signals | kairo | repeatedObservers | 15.8230 |
| Preact Signals | kairo | triangle | 64.3666 |
| Preact Signals | kairo | unstable | 36.0767 |
| Preact Signals | mol | molBench | 488.8898 |
| Preact Signals | s | createDataSignals | 6.4925 |
| Preact Signals | s | createComputations0to1 | 5.7873 |
| Preact Signals | s | createComputations1to1 | 21.4239 |
| Preact Signals | s | createComputations2to1 | 12.6831 |
| Preact Signals | s | createComputations4to1 | 8.4100 |
| Preact Signals | s | createComputations1000to1 | 8.8038 |
| Preact Signals | s | createComputations1to2 | 12.6623 |
| Preact Signals | s | createComputations1to4 | 11.7284 |
| Preact Signals | s | createComputations1to8 | 11.3032 |
| Preact Signals | s | createComputations1to1000 | 10.1483 |
| Preact Signals | s | updateComputations1to1 | 21.9690 |
| Preact Signals | s | updateComputations2to1 | 14.0828 |
| Preact Signals | s | updateComputations4to1 | 9.4205 |
| Preact Signals | s | updateComputations1000to1 | 5.6150 |
| Preact Signals | s | updateComputations1to2 | 15.9666 |
| Preact Signals | s | updateComputations1to4 | 14.6145 |
| Preact Signals | s | updateComputations1to1000 | 12.7447 |
| Preact Signals | dynamic | 10x5 - 2 sources - read 20% (simple component) | 262.5567 |
| Preact Signals | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 211.0395 |
| Preact Signals | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 322.6372 |
| Preact Signals | dynamic | 1000x5 - 25 sources (wide dense) | 515.3151 |
| Preact Signals | dynamic | 5x500 - 3 sources (deep) | 186.5842 |
| Preact Signals | cellx | cellx10 | 0.0748 |
| Preact Signals | cellx | cellx20 | 0.0519 |
| Preact Signals | cellx | cellx30 | 0.0344 |
| TC39 Signals Polyfill | kairo | avoidablePropagation | 333.5350 |
| TC39 Signals Polyfill | kairo | broadPropagation | 1180.6388 |
| TC39 Signals Polyfill | kairo | deepPropagation | 350.8000 |
| TC39 Signals Polyfill | kairo | diamond | 625.6430 |
| TC39 Signals Polyfill | kairo | mux | 920.2542 |
| TC39 Signals Polyfill | kairo | repeatedObservers | 220.0664 |
| TC39 Signals Polyfill | kairo | triangle | 270.6773 |
| TC39 Signals Polyfill | kairo | unstable | 691.1795 |
| TC39 Signals Polyfill | mol | molBench | 528.1687 |
| TC39 Signals Polyfill | s | createDataSignals | 20.4866 |
| TC39 Signals Polyfill | s | createComputations0to1 | 26.9582 |
| TC39 Signals Polyfill | s | createComputations1to1 | 69.4255 |
| TC39 Signals Polyfill | s | createComputations2to1 | 45.2027 |
| TC39 Signals Polyfill | s | createComputations4to1 | 34.1273 |
| TC39 Signals Polyfill | s | createComputations1000to1 | 24.2980 |
| TC39 Signals Polyfill | s | createComputations1to2 | 49.1570 |
| TC39 Signals Polyfill | s | createComputations1to4 | 44.2175 |
| TC39 Signals Polyfill | s | createComputations1to8 | 41.2500 |
| TC39 Signals Polyfill | s | createComputations1to1000 | 36.1400 |
| TC39 Signals Polyfill | s | updateComputations1to1 | 50.9758 |
| TC39 Signals Polyfill | s | updateComputations2to1 | 31.2555 |
| TC39 Signals Polyfill | s | updateComputations4to1 | 19.7204 |
| TC39 Signals Polyfill | s | updateComputations1000to1 | 8.5461 |
| TC39 Signals Polyfill | s | updateComputations1to2 | 46.7393 |
| TC39 Signals Polyfill | s | updateComputations1to4 | 38.2061 |
| TC39 Signals Polyfill | s | updateComputations1to1000 | 33.4170 |
| TC39 Signals Polyfill | dynamic | 10x5 - 2 sources - read 20% (simple component) | 1853.7487 |
| TC39 Signals Polyfill | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 684.4327 |
| TC39 Signals Polyfill | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 13078.9075 |
| TC39 Signals Polyfill | dynamic | 1000x5 - 25 sources (wide dense) | 9289.6686 |
| TC39 Signals Polyfill | dynamic | 5x500 - 3 sources (deep) | 515.4956 |
| TC39 Signals Polyfill | cellx | cellx10 | 0.1069 |
| TC39 Signals Polyfill | cellx | cellx20 | 0.1332 |
| TC39 Signals Polyfill | cellx | cellx30 | 0.0977 |
| SolidJS | kairo | avoidablePropagation | 371.1651 |
| SolidJS | kairo | broadPropagation | 829.2047 |
| SolidJS | kairo | deepPropagation | 349.6282 |
| SolidJS | kairo | diamond | 509.3807 |
| SolidJS | kairo | mux | 482.5398 |
| SolidJS | kairo | repeatedObservers | 68.6999 |
| SolidJS | kairo | triangle | 171.0752 |
| SolidJS | kairo | unstable | 101.4384 |
| SolidJS | mol | molBench | 599.4364 |
| SolidJS | s | createDataSignals | 8.4543 |
| SolidJS | s | createComputations0to1 | 7.9023 |
| SolidJS | s | createComputations1to1 | 40.8815 |
| SolidJS | s | createComputations2to1 | 37.6628 |
| SolidJS | s | createComputations4to1 | 12.3629 |
| SolidJS | s | createComputations1000to1 | 9.9928 |
| SolidJS | s | createComputations1to2 | 18.4796 |
| SolidJS | s | createComputations1to4 | 13.5395 |
| SolidJS | s | createComputations1to8 | 11.7094 |
| SolidJS | s | createComputations1to1000 | 10.8284 |
| SolidJS | s | updateComputations1to1 | 67.7304 |
| SolidJS | s | updateComputations2to1 | 49.5673 |
| SolidJS | s | updateComputations4to1 | 37.7847 |
| SolidJS | s | updateComputations1000to1 | 28.0838 |
| SolidJS | s | updateComputations1to2 | 46.9383 |
| SolidJS | s | updateComputations1to4 | 43.2987 |
| SolidJS | s | updateComputations1to1000 | 39.8077 |
| SolidJS | dynamic | 10x5 - 2 sources - read 20% (simple component) | 1416.7622 |
| SolidJS | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 533.6293 |
| SolidJS | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 649.6802 |
| SolidJS | dynamic | 1000x5 - 25 sources (wide dense) | 1091.0529 |
| SolidJS | dynamic | 5x500 - 3 sources (deep) | 345.3352 |
| SolidJS | cellx | cellx10 | 0.0730 |
| SolidJS | cellx | cellx20 | 0.0715 |
| SolidJS | cellx | cellx30 | 0.0675 |
| Svelte v5 | kairo | avoidablePropagation | 550.1139 |
| Svelte v5 | kairo | broadPropagation | 777.2900 |
| Svelte v5 | kairo | deepPropagation | 378.5183 |
| Svelte v5 | kairo | diamond | 571.8060 |
| Svelte v5 | kairo | mux | 329.4417 |
| Svelte v5 | kairo | repeatedObservers | 71.7272 |
| Svelte v5 | kairo | triangle | 197.5826 |
| Svelte v5 | kairo | unstable | 116.7359 |
| Svelte v5 | mol | molBench | 513.9078 |
| Svelte v5 | s | createDataSignals | 6.5208 |
| Svelte v5 | s | createComputations0to1 | 23.2522 |
| Svelte v5 | s | createComputations1to1 | 26.4137 |
| Svelte v5 | s | createComputations2to1 | 16.4547 |
| Svelte v5 | s | createComputations4to1 | 11.1021 |
| Svelte v5 | s | createComputations1000to1 | 6.2118 |
| Svelte v5 | s | createComputations1to2 | 21.9244 |
| Svelte v5 | s | createComputations1to4 | 19.1390 |
| Svelte v5 | s | createComputations1to8 | 18.0669 |
| Svelte v5 | s | createComputations1to1000 | 17.7070 |
| Svelte v5 | s | updateComputations1to1 | 154.7158 |
| Svelte v5 | s | updateComputations2to1 | 78.9532 |
| Svelte v5 | s | updateComputations4to1 | 42.4923 |
| Svelte v5 | s | updateComputations1000to1 | 4.7730 |
| Svelte v5 | s | updateComputations1to2 | 91.1996 |
| Svelte v5 | s | updateComputations1to4 | 57.5046 |
| Svelte v5 | s | updateComputations1to1000 | 25.2624 |
| Svelte v5 | dynamic | 10x5 - 2 sources - read 20% (simple component) | 740.1305 |
| Svelte v5 | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 339.3187 |
| Svelte v5 | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 526.3607 |
| Svelte v5 | dynamic | 1000x5 - 25 sources (wide dense) | 563.9618 |
| Svelte v5 | dynamic | 5x500 - 3 sources (deep) | 279.5150 |
| Svelte v5 | cellx | cellx10 | 0.1707 |
| Svelte v5 | cellx | cellx20 | 2.7671 |
| Svelte v5 | cellx | cellx30 | 319.0995 |
| @amadeus-it-group/tansu | kairo | avoidablePropagation | 273.3217 |
| @amadeus-it-group/tansu | kairo | broadPropagation | 677.0004 |
| @amadeus-it-group/tansu | kairo | deepPropagation | 211.3821 |
| @amadeus-it-group/tansu | kairo | diamond | 281.5614 |
| @amadeus-it-group/tansu | kairo | mux | 505.9323 |
| @amadeus-it-group/tansu | kairo | repeatedObservers | 55.1474 |
| @amadeus-it-group/tansu | kairo | triangle | 102.2056 |
| @amadeus-it-group/tansu | kairo | unstable | 142.5468 |
| @amadeus-it-group/tansu | mol | molBench | 507.4528 |
| @amadeus-it-group/tansu | s | createDataSignals | 11.1902 |
| @amadeus-it-group/tansu | s | createComputations0to1 | 11.0994 |
| @amadeus-it-group/tansu | s | createComputations1to1 | 48.3740 |
| @amadeus-it-group/tansu | s | createComputations2to1 | 28.1777 |
| @amadeus-it-group/tansu | s | createComputations4to1 | 16.0870 |
| @amadeus-it-group/tansu | s | createComputations1000to1 | 16.2131 |
| @amadeus-it-group/tansu | s | createComputations1to2 | 27.0150 |
| @amadeus-it-group/tansu | s | createComputations1to4 | 24.1159 |
| @amadeus-it-group/tansu | s | createComputations1to8 | 21.9503 |
| @amadeus-it-group/tansu | s | createComputations1to1000 | 20.9390 |
| @amadeus-it-group/tansu | s | updateComputations1to1 | 36.6854 |
| @amadeus-it-group/tansu | s | updateComputations2to1 | 22.6918 |
| @amadeus-it-group/tansu | s | updateComputations4to1 | 14.9062 |
| @amadeus-it-group/tansu | s | updateComputations1000to1 | 9.9849 |
| @amadeus-it-group/tansu | s | updateComputations1to2 | 32.7238 |
| @amadeus-it-group/tansu | s | updateComputations1to4 | 31.4725 |
| @amadeus-it-group/tansu | s | updateComputations1to1000 | 32.0707 |
| @amadeus-it-group/tansu | dynamic | 10x5 - 2 sources - read 20% (simple component) | 454.8114 |
| @amadeus-it-group/tansu | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 294.8667 |
| @amadeus-it-group/tansu | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 549.3439 |
| @amadeus-it-group/tansu | dynamic | 1000x5 - 25 sources (wide dense) | 660.8717 |
| @amadeus-it-group/tansu | dynamic | 5x500 - 3 sources (deep) | 239.6170 |
| @amadeus-it-group/tansu | cellx | cellx10 | 0.0993 |
| @amadeus-it-group/tansu | cellx | cellx20 | 0.0972 |
| @amadeus-it-group/tansu | cellx | cellx30 | 0.0810 |
| @tldraw/state | kairo | avoidablePropagation | 336.9156 |
| @tldraw/state | kairo | broadPropagation | 846.7144 |
| @tldraw/state | kairo | deepPropagation | 278.6244 |
| @tldraw/state | kairo | diamond | 447.3274 |
| @tldraw/state | kairo | mux | 626.8213 |
| @tldraw/state | kairo | repeatedObservers | 56.5847 |
| @tldraw/state | kairo | triangle | 197.3980 |
| @tldraw/state | kairo | unstable | 98.2564 |
| @tldraw/state | mol | molBench | 515.7496 |
| @tldraw/state | s | createDataSignals | 8.3806 |
| @tldraw/state | s | createComputations0to1 | 7.3094 |
| @tldraw/state | s | createComputations1to1 | 20.4350 |
| @tldraw/state | s | createComputations2to1 | 20.7375 |
| @tldraw/state | s | createComputations4to1 | 11.0783 |
| @tldraw/state | s | createComputations1000to1 | 14.6655 |
| @tldraw/state | s | createComputations1to2 | 17.2737 |
| @tldraw/state | s | createComputations1to4 | 15.7228 |
| @tldraw/state | s | createComputations1to8 | 14.9177 |
| @tldraw/state | s | createComputations1to1000 | 13.7870 |
| @tldraw/state | s | updateComputations1to1 | 68.4635 |
| @tldraw/state | s | updateComputations2to1 | 40.8131 |
| @tldraw/state | s | updateComputations4to1 | 28.9675 |
| @tldraw/state | s | updateComputations1000to1 | 23.0139 |
| @tldraw/state | s | updateComputations1to2 | 55.0267 |
| @tldraw/state | s | updateComputations1to4 | 46.5703 |
| @tldraw/state | s | updateComputations1to1000 | 39.5087 |
| @tldraw/state | dynamic | 10x5 - 2 sources - read 20% (simple component) | 719.3505 |
| @tldraw/state | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 446.9938 |
| @tldraw/state | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 4990.9932 |
| @tldraw/state | dynamic | 1000x5 - 25 sources (wide dense) | 4882.4460 |
| @tldraw/state | dynamic | 5x500 - 3 sources (deep) | 339.1077 |
| @tldraw/state | cellx | cellx10 | 0.1607 |
| @tldraw/state | cellx | cellx20 | 0.1570 |
| @tldraw/state | cellx | cellx30 | 0.1899 |
| uSignal | kairo | avoidablePropagation | 554.1345 |
| uSignal | kairo | broadPropagation | 626.3696 |
| uSignal | kairo | deepPropagation | 214.2281 |
| uSignal | kairo | diamond | 358.1883 |
| uSignal | kairo | mux | 630.3687 |
| uSignal | kairo | repeatedObservers | 51.5996 |
| uSignal | kairo | triangle | 142.2580 |
| uSignal | kairo | unstable | 70.4304 |
| uSignal | mol | molBench | 702.5363 |
| uSignal | s | createDataSignals | 9.4024 |
| uSignal | s | createComputations0to1 | 7.8049 |
| uSignal | s | createComputations1to1 | 42.5141 |
| uSignal | s | createComputations2to1 | 18.6841 |
| uSignal | s | createComputations4to1 | 16.8079 |
| uSignal | s | createComputations1000to1 | 13.3875 |
| uSignal | s | createComputations1to2 | 23.2207 |
| uSignal | s | createComputations1to4 | 22.7107 |
| uSignal | s | createComputations1to8 | 21.7363 |
| uSignal | s | createComputations1to1000 | 14.2774 |
| uSignal | s | updateComputations1to1 | 37.2749 |
| uSignal | s | updateComputations2to1 | 24.2865 |
| uSignal | s | updateComputations4to1 | 15.8797 |
| uSignal | s | updateComputations1000to1 | 14.8220 |
| uSignal | s | updateComputations1to2 | 32.7008 |
| uSignal | s | updateComputations1to4 | 28.9843 |
| uSignal | s | updateComputations1to1000 | 35.7875 |
| uSignal | dynamic | 10x5 - 2 sources - read 20% (simple component) | 461.3069 |
| uSignal | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 438.0493 |
| uSignal | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 518.1629 |
| uSignal | dynamic | 1000x5 - 25 sources (wide dense) | 1227.1888 |
| uSignal | dynamic | 5x500 - 3 sources (deep) | 294.0930 |
| uSignal | cellx | cellx10 | 0.0693 |
| uSignal | cellx | cellx20 | 0.0527 |
| uSignal | cellx | cellx30 | 0.1755 |
| @vue/reactivity | kairo | avoidablePropagation | 224.2770 |
| @vue/reactivity | kairo | broadPropagation | 476.1232 |
| @vue/reactivity | kairo | deepPropagation | 147.7976 |
| @vue/reactivity | kairo | diamond | 242.5340 |
| @vue/reactivity | kairo | mux | 440.7409 |
| @vue/reactivity | kairo | repeatedObservers | 25.8754 |
| @vue/reactivity | kairo | triangle | 78.9357 |
| @vue/reactivity | kairo | unstable | 69.8174 |
| @vue/reactivity | mol | molBench | 502.5226 |
| @vue/reactivity | s | createDataSignals | 8.7996 |
| @vue/reactivity | s | createComputations0to1 | 6.5399 |
| @vue/reactivity | s | createComputations1to1 | 18.7520 |
| @vue/reactivity | s | createComputations2to1 | 12.0243 |
| @vue/reactivity | s | createComputations4to1 | 10.9015 |
| @vue/reactivity | s | createComputations1000to1 | 11.6863 |
| @vue/reactivity | s | createComputations1to2 | 16.3955 |
| @vue/reactivity | s | createComputations1to4 | 12.4093 |
| @vue/reactivity | s | createComputations1to8 | 10.9620 |
| @vue/reactivity | s | createComputations1to1000 | 10.6710 |
| @vue/reactivity | s | updateComputations1to1 | 24.2697 |
| @vue/reactivity | s | updateComputations2to1 | 16.1034 |
| @vue/reactivity | s | updateComputations4to1 | 12.3503 |
| @vue/reactivity | s | updateComputations1000to1 | 7.7295 |
| @vue/reactivity | s | updateComputations1to2 | 19.2744 |
| @vue/reactivity | s | updateComputations1to4 | 18.2013 |
| @vue/reactivity | s | updateComputations1to1000 | 17.2609 |
| @vue/reactivity | dynamic | 10x5 - 2 sources - read 20% (simple component) | 333.2438 |
| @vue/reactivity | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 242.7164 |
| @vue/reactivity | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 412.0021 |
| @vue/reactivity | dynamic | 1000x5 - 25 sources (wide dense) | 776.5627 |
| @vue/reactivity | dynamic | 5x500 - 3 sources (deep) | 233.2679 |
| @vue/reactivity | cellx | cellx10 | 0.1067 |
| @vue/reactivity | cellx | cellx20 | 0.1028 |
| @vue/reactivity | cellx | cellx30 | 0.0827 |
| frameact | kairo | avoidablePropagation | 223.2858 |
| frameact | kairo | broadPropagation | 503.5294 |
| frameact | kairo | deepPropagation | 218.1365 |
| frameact | kairo | diamond | 261.1774 |
| frameact | kairo | mux | 400.5575 |
| frameact | kairo | repeatedObservers | 46.4839 |
| frameact | kairo | triangle | 110.9624 |
| frameact | kairo | unstable | 136.7623 |
| frameact | mol | molBench | 499.4971 |
| frameact | s | createDataSignals | 15.3639 |
| frameact | s | createComputations0to1 | 10.3275 |
| frameact | s | createComputations1to1 | 64.8994 |
| frameact | s | createComputations2to1 | 71.8956 |
| frameact | s | createComputations4to1 | 71.5339 |
| frameact | s | createComputations1000to1 | 17.1814 |
| frameact | s | createComputations1to2 | 32.0495 |
| frameact | s | createComputations1to4 | 20.7965 |
| frameact | s | createComputations1to8 | 16.6549 |
| frameact | s | createComputations1to1000 | 16.4739 |
| frameact | s | updateComputations1to1 | 35.4407 |
| frameact | s | updateComputations2to1 | 23.3253 |
| frameact | s | updateComputations4to1 | 14.8440 |
| frameact | s | updateComputations1000to1 | 9.2991 |
| frameact | s | updateComputations1to2 | 30.0130 |
| frameact | s | updateComputations1to4 | 28.1492 |
| frameact | s | updateComputations1to1000 | 24.9010 |
| frameact | dynamic | 10x5 - 2 sources - read 20% (simple component) | 408.9042 |
| frameact | dynamic | 10x10 - 6 sources - dynamic - read 20% (dynamic component) | 317.2810 |
| frameact | dynamic | 1000x12 - 4 sources - dynamic (large web app) | 469.4107 |
| frameact | dynamic | 1000x5 - 25 sources (wide dense) | 727.8113 |
| frameact | dynamic | 5x500 - 3 sources (deep) | 257.3668 |
| frameact | cellx | cellx10 | 0.0932 |
| frameact | cellx | cellx20 | 0.0703 |
| frameact | cellx | cellx30 | 0.2122 |
