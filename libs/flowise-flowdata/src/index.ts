// Core
export * from './t-flowdata';
export * from './edges';
export * from './nodes-base';
export * from './build-chatflow';

// Typed factories — самые используемые ноды в slovo
export * from './factories/chat-models';
export * from './factories/embeddings';
export * from './factories/splitters';
export * from './factories/vectorstores';
export * from './factories/chains';
export * from './factories/memory';
export * from './factories/loaders';

// Fallback для всех остальных нод (через introspection или вручную)
export * from './factories/generic';
