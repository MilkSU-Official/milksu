#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
    FILE *input = fopen("poc", "rb");
    if (!input) return 0;
    size_t n=8; char *p=malloc(n); if(p){fread(p,1,8,input); free(p);}
    fclose(input);
    return 0;
}
