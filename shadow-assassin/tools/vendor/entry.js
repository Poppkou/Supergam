// Сборка three.js в один классический скрипт (WebView не грузит ES-модули с file://).
import * as THREE from 'three';
window.THREE = Object.assign({}, THREE);
