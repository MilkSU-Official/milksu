#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
    FILE *input = fopen("poc", "rb");
    if (!input) return 0;
    char *p=malloc(8); int i; fread(&i,4,1,input); p[i]=1;
    fclose(input);
    return 0;
}
