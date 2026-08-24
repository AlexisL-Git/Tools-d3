'use strict';
// Point d'entree du paquet. Avec jsc.js, c'est le SEUL fichier de l'amorceur
// qui reste en clair: il installe le chargeur de bytecode, il ne peut donc pas
// etre lui-meme compile. Le garder a trois lignes est deliberat — ce qui n'est
// pas ici ne peut pas fuir.
require('./jsc');
require('./principal');
