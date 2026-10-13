import 'frameact/dom/controlled';
import { setAttribute } from 'frameact/dom';

// the name is assembled at run time on purpose: a quoted literal would make the Vite plugin inject the registration itself
setAttribute(document.body.appendChild(document.createElement('input')), ['use', 'value'].join(':'), () => 'x');
