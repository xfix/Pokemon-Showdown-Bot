// Temporary workaround for Map only being available in ES6 target mode,
// which I don't want, because it doesn't use require function.

interface Map<K, V> {
    set(key: K, value: V): Map<K, V>;
    has(key: K): boolean;
    get(key: K): V;
    delete(key: K): boolean;
    clear(): void;
    forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void;
    size: number;
}

interface MapConstructor {
    new <K, V>(): Map<K, V>;
}

declare var Map: MapConstructor;
